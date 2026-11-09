# Milestone 30: entity extraction and distillation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Every import gains the option **Keep pages as Sources**. On, every page is written as a read-only **Source** object (its text exactly as imported, its kept original, its `importSource` provenance); off, pages are filed into their mapped types as imports do today. On a batch kept as Sources, the AI filing pass also returns, per page, its **main entity** (what the page is mainly about), the **entity candidates** it mentions, short **summary lines** about each, and the **relations** between them, each with its quote. The app checks them, resolves duplicates into one entity per thing (names and aliases, plus the agent's merges), and shows Gene a new **Entities** step in the import wizard where each entity can be accepted, renamed, merged, split or turned down. On **Write**, each accepted entity is **distilled from all the Sources that mention it**: its properties (each value carrying its Sources and quote; when Sources disagree the most recently modified one wins and the conflict is listed), a **Sources** relation to them (shown on each Source as **Distilled into**), and a **"From sources"** section at the top of its body that the import owns, every line citing its Sources as links, above Gene's own notes, which it never touches. Relations are written on their stored side (a relation outside the named set becomes a plain link) and low-confidence links go to the Import inbox. **A Source's text is never edited**, not even to link a mention. In an IT ops space the schema proposal enforces the conventions: existing types first, no look-alike types ("Use <type>, with a category"), categories never types or entities.

**Architecture.** Five modules under `backend/objectapp/importers/`, each with one job: `entitycheck.py` checks one decision's candidates against its page (M27's `filing._check_quote` rules); `entities.py` does resolution, value picking, the entity rule, Gene's review and the wizard's view (reads only); `sources.py` holds the Source rules (the option's default, the Source type from M28's `basicsetup.source_type()`, Category and System, the read-only rule's names); `distill.py` builds and safely rewrites the "From sources" section and keeps each entity's citations in `.object/distilled/<entity id>.json`; `entitywrite.py` writes what Gene accepted (entities, values, the Sources relation, relations through M28's counterparts, sections). M25's `planner.py` and `writer.py` write a batch's pages as Sources when the option is on (and update a Source on a re-run of its source, with the previous text in version history); `space.py` makes imported Sources read-only ("Imported source"), with one write context that only that re-run uses. M27's `proposal.py` gains the IT ops conventions (5b). `importers/filing.py` (M27) keeps its behaviour for a batch not kept as Sources; for one kept as Sources the pass only checks and records, ends in a new `entities` state, and runs the Write in its worker thread. Routes go on M27's `api_import_agent.py`; an outside agent reads the list through a new read tool `import_entities` (there is no tool to accept or write entities, as there is none to apply a proposal). The front end adds the option to the import wizard's options, `EntitiesStep.tsx` between Trial and Normalise in M27's `AgentFlow`, and the proposal step's "Use <type>, with a category".

**Tech Stack.** Python 3 (FastAPI, pydantic), `uv`; React, TypeScript, shadcn/ui, Tailwind, vitest. No new dependencies. Agent runs only through the `claude` CLI as M27 runs them; tests use the fake `claude` (`backend/tests/fake_claude.py`, whose `FAKE_CLAUDE_FILING` decisions pass the new fields through unchanged).

**Spec.** `docs/superpowers/specs/2026-11-09-it-ops-type-model-design.md`, **sections 5** (entity extraction on import, with its amended "Writing" bullet: a Source's text is never edited), **5a** (Sources and distillation, including "An option on every import") and **5b** (conventions are rules in an IT ops space), and the superseded line in "Decided by Gene" (a page no longer becomes its main entity's notes); extending sections **5** (re-runs), **8** (the schema proposal), **9** (the AI filing pass) and **12** (MCP tools) of `docs/superpowers/specs/2026-11-06-import-migration-design.md`. Built after M28 (IT ops starter, the Source type, two-way relations) and M29 (synced facts and type suggestion); their names are consumed as their plans give them.

## Global Constraints

- **Keep pages as Sources** (`keepAsSources`) is an option on every import. On: every page becomes a Source, and with the AI filing pass entities are distilled from them. Off: pages are filed into their mapped types, and the AI filing pass runs as M27 built it. Default: on when the import runs the AI filing pass (an agent's import, `requireApproved`, or one that adopts a draft batch with a schema proposal), off for a plain mapped import. The batch records the value.
- **A Source's text is byte-identical to the imported text.** No page is turned into an entity, renamed, retyped or given a mention link. The only writes to a Source are its creation by its import and a re-run of the same source (the previous text kept in version history).
- **A Source is read-only in the app** (reason `"Imported source"`): every write path (property edits, body saves, rename, type change, mention links, `/api/v1`, MCP, agents, automations, M30's Write) refuses it. Only the M25 re-run writes it, inside `Space.source_writes()`.
- Nothing from the filing pass is written before Gene's approval of the schema (M27's Apply) and of the entity list (this milestone's **Write**). On a batch kept as Sources the filing pass, the trial, reading the Entities step, saving the review and the MCP read write no `.md` file and no type; they write only the batch's records in `.object/imports/<batch>/`.
- **The "From sources" section is the import's; everything else in an entity's body is Gene's.** A rewrite replaces only the bytes between the section's markers, only when a cited Source changed or a new Source cites the entity, and never when Gene edited the section (it is left alone and reported).
- Never write on read; property edits change only their own lines; at most one `update_properties` per object for all its values, aliases, Sources, tags, collections and relation links, plus at most one section write; CRLF and BOM kept; atomic writes through `Space._write`.
- Per-value citations are kept in `.object/distilled/<entity id>.json` and the batch records, never in the `.md` file.
- Deletes go to the Trash: Move batch to Trash moves the batch's Sources (its pages, as M25 does) and the entities the batch **created** (not objects it only linked to or distilled into), restorable.
- One side of a relation is stored (M28's "Stored on" side, in that object's frontmatter); the counterpart ("Distilled into" included) is computed by M28's index and never written.
- Every value, alias, summary line and relation needs a quote copied from the page; the app checks it (M27's rules: the quote is in the document, has at least `MIN_QUOTE = 3` characters, and says the value).
- **The entity rule** (spec section 5): a candidate becomes an object when it exists on its own (a page is mainly about it), or more than one page mentions it (`MIN_PAGES = 2`), or it has properties of its own (a value that passed its check). Otherwise it stays text. Categories (Server, VM, Production: a label option of a type in the space, or a tag) become property values or tags, never entities.
- **When Sources disagree** on a value, the value from the most recently modified Source (`importSource.modified`, else `importedAt`) wins; the conflict is listed in the import report and on the entity (its "From sources" section), with both values and their Sources. The import never replaces a value Gene set.
- **In an IT ops space** (design 5b): existing types first; a proposed type whose properties match an existing type's is refused, with "Use <type>, with a category" offered; a category is never a type or an entity; a relation outside the named set (M28's relation and counterpart names) is written as a plain link.
- Trial pass: `TRIAL_SIZE = 50` objects; agent batches of `BATCH_SIZE = 40`; confidence levels `high | medium | low`; quotes and the scan run as in M27.
- Links from low-confidence candidates (the relation's confidence, or either side's, is `low`) are not written: the subject entity goes to the "Import inbox" collection with the reason (never a Source, whose text and frontmatter stay as imported).
- Synced properties (M29 `PropertyDefinition.synced`) are never filled by the import.
- Unlinked mentions stay: the import links no mention, so an entity's mentions in Sources keep showing under its unlinked mentions.
- Document text is untrusted: the decisions block is the only thing taken from a run; the run stays read-only (M27's `filing_write_guard`).
- Fixtures are synthetic (hosts `APP01`, `SRV-DB01`; software "SQL Server 2019"; application "Payroll"; location "HQ"; addresses `10.0.0.x`). No real CPI data. Tests use `OBJECT_STATE_DIR` in a temp folder and the fake `claude`; never `~/.claude`.
- The server binds 127.0.0.1 only; `/api` needs the per-launch key (tests built with `create_app` and no `ui_key` skip it).
- Never name the original notes app nor the open-source agent whose patterns the agents design adopts.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The failure modes no task's ordinary tests would catch, most likely first. Each has its test in the owning task.

1. **A Source is edited outside its import: its text is not byte-identical to the imported text.** A property edit, body save, rename, type change, mention link, v1, MCP, agent or automation write that gets through; M30's Write touching a Source (tags, collections, the inbox, a link); the filing pass or trial writing a page (M27 does on a batch not kept as Sources); the re-run's write context leaking to another thread; a re-run that loses the old text from version history. Test: `backend/tests/test_m30_sources.py::test_source_is_byte_identical_to_the_import`, `::test_imported_source_is_read_only`, `::test_source_writes_is_per_thread` and `::test_rerun_updates_source_with_history` (T4), `backend/tests/test_m30_write.py::test_write_never_touches_a_source` (T6), and `backend/tests/test_m30_filing.py::test_pass_and_trial_write_nothing` (T8).
2. **Rewriting the distilled section touches Gene's notes.** A rewrite that eats the line after the closing marker, a section Gene moved or edited, a missing or doubled closing marker, a `<!-- group -->` Gene nested inside, CRLF bodies, an entity whose body Gene wrote before the first import (the section must go on top, his bytes untouched below). Test: `backend/tests/test_m30_distill.py::test_replace_section_keeps_everything_outside` and `::test_edited_or_broken_section_is_left_alone` (T5), and `test_m30_write.py::test_rerun_rewrites_only_the_section` (T6).
3. **The option's default or value is lost.** A plain mapped import becoming Sources, an agent's import not becoming Sources, the wizard's choice not reaching the writer, the preview showing mapped types while the import writes Sources, a re-run of a Source batch filing pages into types. Test: `test_m30_sources.py::test_option_defaults_and_values` (T4) and `frontend/src/import/keepAsSources.m30.test.tsx` (T12).
4. **Duplicates.** An entity that already exists in the space (Gene's own Host "app01", or one an earlier batch of the same source made) gets a second object; a Source taken for the entity of the same name; a double press of Write, or a retry after a failed write, places entities twice. Test: `test_m30_write.py::test_existing_object_is_reused_and_write_is_resumable` (T6) and `test_m30_filing.py::test_rerun_and_second_write_create_nothing_new` (T8).
5. **Conflicts pick the wrong value or lose one.** The older Source winning; equal values from two Sources counted as a conflict; a conflict missing from the report or the entity; a re-run replacing a value Gene typed. Test: `backend/tests/test_m30_resolve.py::test_newest_source_wins_and_conflict_kept` (T3) and `test_m30_write.py::test_gene_values_never_replaced` (T6).
6. **Invented facts pass.** An alias the page never says, an entity name not in the page, a summary line whose quote isn't in the page, a relation whose quote names only one side, a value for a synced property or for `sources`, a category ("Server") or a Source as an entity. Test: `backend/tests/test_m30_check.py::test_invented_aliases_names_lines_relations_and_synced_values_refused` (T2) and `test_m30_resolve.py::test_categories_and_single_mentions_are_left_out` (T3).
7. **A look-alike type slips through, or the rules fire outside an IT ops space.** Test: `backend/tests/test_m30_conventions.py::test_lookalike_type_refused_with_offer` and `::test_rules_off_outside_itops` (T7).
8. **Move batch to Trash takes too much or too little.** Created entities left behind; an object that existed before the import trashed; a Source that can't be trashed or restored because it is read-only. Test: `test_m30_filing.py::test_trash_batch_takes_sources_and_created_entities_only` (T8).

---

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| The option | `StartImportRequest.keepAsSources: bool \| None` and `ImportPreviewRequest.keepAsSources: bool \| None` (`importers/model.py`); the resolved value in `batch.json` as `keepAsSources: bool` | the wizard and the v1/MCP `start_import`; `api_import` resolves the default (T4) |
| The Source type | `.object/types/source.json`, from M28's `basicsetup.source_type()`; written by the first import kept as Sources, in any space; an IT ops space has it already | `sources.ensure_source_type`, from the writer's types phase (T4) |
| Source objects | each page of a batch kept as Sources: `type` Source, `category` (`sources.category_for`), `system` (`sources.system_label`), the page's other fields as the planner writes them (not declared on Source), `importSource`, the body as imported; in the Source type's folder; read-only | M25's `writer` (T4); a re-run of its source only |
| Checked candidates per page | M27's `filing.json` (`.object/imports/<batch>/`), in each result: `mainEntity`, `entities`, `relations`, `merges`, and the page's checked `tags` and `collections` (put on its main entity at Write) | `Filing` (T8), from `entitycheck.check_candidates` |
| Gene's review | `.object/imports/<batch>/entities-review.json`: `EntitiesReview` | `Filing.save_entity_review` (T8) |
| What Write did | `.object/imports/<batch>/entities-written.json`: `{placed: {entityId: path}, done: {entityId: ["values", "section"]}, outcome: EntitiesWritten \| null}` (written after each step, so a retry resumes) | `entitywrite.write_entities` (T6) |
| The Sources relation | M28's `basicsetup.sources_property()` (`sources`, → source, counterpart Distilled into) on the entity's type; on the nine IT ops entity types already; added by one type save to any other type an accepted entity has, at Write | `entitywrite` (T6) |
| Created entities | new `.md` objects in their type's folder, with an `importSource` block `{system: <batch source system>, id: "entity:<typeId>:<key>", batch, importedAt}`, and a `created` entry in `items.json`: `{sourcePath: "entity:<typeId>:<key>", system, id, title, path, action: "created", entity: true}` | `entitywrite` (T6) |
| Entity values, aliases, Sources, tags, collections | the entity's frontmatter, one `update_properties`: values (rules in T6), aliases, `sources: [{target, path}]` (main Sources first, then by path), the main page's passing tags and collections, "Import inbox" for a low-confidence link | `entitywrite` (T6) |
| Citations | `.object/distilled/<entity id>.json`: `DistilledRecord` (below); per value its Sources, quote and any conflict; the section's hash and the versions of the Sources it cites | `distill.save_record`, from `entitywrite` (T6) |
| "From sources" section | the top of the entity's body, between `SECTION_OPEN` and its matching `SECTION_CLOSE` (below); the entity's links to its Sources and to what they mention live here and in the Sources relation | `entitywrite` with `distill.replace_section` (T6) |
| Relations | the stored side's relation property in its frontmatter, value `{target: <title>, path}` as M27's links pass writes | `entitywrite` (T6) |
| Plain links | a relation outside the named set: an `Also linked:` line in the subject's "From sources" section | `entitywrite` (T6) |
| Low-confidence links | M27's `inbox.json` rows `{path, title, reason, suggestedType: null}` with the subject entity's path, and the entity in the "Import inbox" collection | `Filing` (T8) |
| Report | a `## Entities` section in the batch's `report.md` and report page (beside M27's `## AI filing`), with a `### Sources disagree` list | `Filing` (T8) |

The resolved entity list is **computed** from `filing.json` and `entities-review.json` on every read (never stored), so a read writes nothing and the list can't go stale.

### The decision, extended (what the agent returns on a batch kept as Sources; spec sections 5 and 5a)

```jsonc
{ "path": "...", "confidence": "high",
  "tags": [...], "collections": [...],                                            // M27; put on the page's main entity at Write
  "type": null, "values": [], "links": [],                                        // M27; not applied: the page stays a Source (a note says so)
  "mainEntity": {"type": "Host", "name": "APP01", "aliases": ["app01.corp.example"],
                 "values": [{"key": "fqdn", "value": "app01.corp.example", "quote": "..."}],
                 "lines": [{"text": "The Payroll server at HQ.", "quote": "APP01 is the Payroll server at HQ"}]},   // or null
  "entities": [{"type": "Software", "name": "SQL Server 2019", "aliases": ["SQL 2019"],
                "values": [{"key": "version", "value": "2019", "quote": "..."}],
                "lines": [{"text": "...", "quote": "..."}], "confidence": "medium"}],
  "relations": [{"subject": "Payroll", "relation": "Runs on", "object": "APP01", "quote": "...", "confidence": "high"}],
  "merges": [{"type": "Software", "names": ["SQL 2019", "SQL Server 2019"]}] }
```

On a batch not kept as Sources the decision is M27's, applied as M27 does, and the new fields are ignored. `mainEntity` is **which entity the page is mainly about**: that entity gets this page's Source linked first, its summary lines first, and its values win ties (equal modified times). It is not a takeover: the page stays a Source. A runbook, script or prompt page is mainly about itself (a Runbook, Script or Prompt named as the page). A candidate's `confidence` defaults to its decision's. `subject` / `object` are entity names or aliases, or the title of an object already in the space. `relation` is a relation property's name on the subject's type, or (M28) a counterpart's name, in which case the link is stored on the other side; any other name is a **plain link**. `lines` are the filing pass's summary of the entity from this page, one short sentence each, each with its quote.

### Python names (`backend/objectapp/importers/`; T1 writes them as stubs raising `NotImplementedError`, the owning task fills them)

```python
# entitycheck.py (T2)
MIN_PAGES = 2
MAX_LINE = 200                                           # characters in one summary line
def check_candidates(space: Space, decision: dict, doc: str, page_path: str, page_title: str) -> dict
    # -> {"mainEntity": CheckedEntity | None, "entities": [CheckedEntity], "relations": [CheckedRelation],
    #     "merges": [{"typeId", "names": [str], "ok": bool, "reason"?: str}]}
# CheckedEntity = {"typeId", "type", "name", "aliases": [str], "values": [{"key","value","quote","ok","reason"?}],
#                  "lines": [{"text","quote","ok","reason"?}], "confidence", "main": bool, "ok": bool, "reason"?: str}
# CheckedRelation = {"subject","relation","object","quote","confidence","plain": bool,"ok": bool, "reason"?: str}

# distill.py (T5)
SECTION_OPEN = "<!-- group from-sources -->"
SECTION_CLOSE = "<!-- /group -->"                        # the matching close of the M7 group container
SECTION_HEADING = "## From sources"
DISAGREE_HEADING = "Sources disagree:"
ALSO_LINKED = "Also linked:"
MAX_LINES = 12                                           # summary lines per entity
DISTILLED_DIR = "distilled"                              # .object/distilled/<entity id>.json
class SectionEdited(Exception): ...                      # the section differs from its recorded hash, or its bounds are broken
class SourceRef(TypedDict): path: str; quote: str; modified: str | None
class PickedValue(TypedDict):
    value: Any; sources: list[SourceRef]                  # the winning value and every Source that says it
    conflict: list[dict] | None                          # [{"value", "sources": [SourceRef]}] for each losing value
class SummaryLine(TypedDict): text: str; sources: list[SourceRef]
def pick_values(found: dict[str, list[dict]], main_pages: set[str]) -> dict[str, PickedValue]
    # found: key -> [{"value","quote","page","modified"}]; newest Source wins, main page then path on a tie
def summary_lines(found: list[dict], main_pages: set[str]) -> list[SummaryLine]   # merged by norm text, at most MAX_LINES
def build_section(lines: list[SummaryLine], picked: dict[str, PickedValue], plain: list[dict],
                  cite: Callable[[str], str], label: Callable[[str], str]) -> str          # "\n" endings
def find_section(body: str) -> tuple[int, int] | None    # [start, end) of the section incl. markers; SectionEdited when broken
def replace_section(body: str, section: str, recorded_hash: str | None) -> str  # top of body when absent; SectionEdited
def section_hash(section: str) -> str                    # "sha256:...", line endings normalised
def load_record(root: Path | str, entity_id: str) -> dict | None                 # DistilledRecord
def save_record(root: Path | str, entity_id: str, record: dict) -> None          # atomic

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
    pages: list[str]        # the Sources that mention it (provenance): main pages first, then by path
    mainPages: list[str]
    values: dict[str, PickedValue]   # distill.pick_values over every passing value
    lines: list[SummaryLine]
    confidence: str         # the highest of its candidates
    joinedByAgent: bool     # an agent merge joined it (offered as a split)
    rule: str | None        # "own" | "pages" | "properties" | None (stays text)
    category: bool
    existing: str | None    # path of an object of this type already in the space with that name or alias (never a Source)
def norm_name(text: str) -> str
def resolve(space: Space, results: dict[str, dict], review: dict | None = None) -> Resolution
@dataclass
class Resolution:
    entities: list[Entity]                     # rule met, not a category
    leftOut: list[Entity]                      # rule None or category
    suggestedMerges: list[dict]                # [{"ids": [...], "names": [...]}], near-duplicates within a type
    relations: list[dict]                      # every ok CheckedRelation, with "page"
    pages: list[str]                           # every page (Source) of the results
def load_review(root: Path | str, batch: str) -> dict                 # EntitiesReview, empty when absent
def save_review(space: Space, batch: str, review: dict, results: dict[str, dict]) -> dict   # ReviewInvalid
def accepted(res: Resolution, review: dict) -> list[tuple[Entity, str]]  # (entity, final name), accepted or renamed
def undecided(res: Resolution, review: dict) -> list[str]                # ids of entities with no decision
def view(space: Space, batch: str, results: dict[str, dict], state: str) -> dict   # EntitiesView

# sources.py (T4)
SOURCE_TYPE_ID = "source"
SOURCE_READ_ONLY = "Imported source"
SYSTEM_LABELS = {"sharepoint": "SharePoint", "wiki": "Wiki", "notion": "Notion", "obsidian": "Obsidian",
                 "anytype": "Anytype", "files": "Files", "markdown": "Markdown"}
def keep_as_sources(asked: bool | None, require_approved: bool, has_proposal: bool) -> bool   # the option's default rule
def ensure_source_type(space: Space) -> str              # the Source type's id; writes it only when absent
def category_for(block: dict, path: str) -> str | None   # a Category option, from the original's format, then the system
def system_label(block: dict) -> str | None
def is_imported_source(type_id: str | None, fm: dict) -> bool   # type id "source" and an importSource block
def is_source_batch(root: Path | str, batch: str) -> bool        # batch.json keepAsSources

# entitywrite.py (T6)
WRITTEN_FILE = "entities-written.json"
def write_entities(space: Space, batch: str, system: str, imported_at: str,
                   chosen: list[tuple[Entity, str]], res: Resolution, results: dict[str, dict],
                   items: list[dict]) -> dict
    # -> EntitiesWritten plus "inboxLinks": [{"path","title","reason"}] and "conflicts": [ConflictRow];
    #    appends created items to `items`

# proposal.py (T7, M27's module)
LOOKALIKE_SHARE = 0.8
OFFER = "Use {type}, with a category"
def is_itops_space(space: Space) -> bool                 # setup "itops", or types host, software and application present
def named_relations(space: Space) -> set[str]            # casefolded relation and counterpart names of the space's types
def lookalike(props: list[dict], space: Space) -> TypeDefinition | None

# filing.py (T8), new Filing methods (a batch kept as Sources only; NotAllowed otherwise)
def entities_view(self, batch: str) -> dict                   # KeyError: no such batch
def save_entity_review(self, batch: str, review: dict) -> dict  # ReviewInvalid, NotAllowed (written already)
def write_entities(self, batch: str) -> None                  # starts the worker; Busy, NotAllowed
```

Import planning and writing (T4):

```python
# planner.py
def plan(read, mapping, target, now=None, reuse=None, lenient=False, keep_as_sources: bool = False) -> Planned
    # keep_as_sources: every page planned as type Source (its mapped type neither created nor extended), its
    # fields kept as frontmatter keys; images and files stay M25's Image/File objects
# writer.py: WriteState gains keep_as_sources: bool; batch.json gains "keepAsSources"
# space.py
def Space.source_writes(self) -> ContextManager[None]   # this thread may write imported Sources while inside; nests
# ObjectSummary of an imported Source: readOnly True, readOnlyReason SOURCE_READ_ONLY
# Space._write on an imported Source outside source_writes(): raises ReadOnly(SOURCE_READ_ONLY)
def Space.add_type(self, t: TypeDefinition) -> TypeDefinition   # writes a type whose id is free and loads it
```

`DistilledRecord`:

```jsonc
{ "id": "<entity id>", "path": "Hosts/APP01.md", "batch": "<last batch>",
  "values": { "ipAddress": { "value": "10.0.0.5", "setByImport": "10.0.0.5",
                             "sources": [{"path": "Sources/APP01.md", "quote": "IP address: 10.0.0.5", "modified": "2026-10-01T00:00:00Z"}],
                             "conflict": [{"value": "10.0.0.6", "sources": [{"path": "Sources/Old APP01 notes.md", "quote": "...", "modified": "2025-06-01T00:00:00Z"}]}] } },
  "section": { "hash": "sha256:...", "cites": {"Sources/APP01.md": "<file version>"} } }
```

`ConflictRow = {entity: {path, title}, key, name, kept: {value, sources}, others: [{value, sources}]}`.

### The "From sources" section (our format)

```markdown
<!-- group from-sources -->
## From sources

- The Payroll server at HQ. ([[Sources/APP01|APP01]])
- Payroll runs on it. ([[Payroll]])

Sources disagree:
- IP address: 10.0.0.5 ([[Sources/APP01|APP01]]) or 10.0.0.6 ([[Old APP01 notes]]); 10.0.0.5 kept, from the newer source.

Also linked: [[SRV-DB01]] (backs up to)
<!-- /group -->
```

- The bounds are M7's **group** container annotation (`<!-- group … -->` … `<!-- /group -->`), so the editor round-trips it and shows it as one grouped block; the `from-sources` option marks it as the import's. The close is the group close that matches the open, counting nested groups.
- It sits at the top of the body; a blank line separates it from what follows. When absent it is inserted before the first body line; existing bytes move down unchanged.
- Every line cites its Sources with the link text `link_mention` would use (`[[title]]` when the title resolves from the entity to that Source, else `[[<link text>|title]]`), so a Source titled like its entity (`APP01`) is never confused with it. These citations, and the Sources relation, are how an entity links to its Sources; the Sources themselves are never given a link.
- The record keeps the section's hash and the versions of the Sources it cites. A later Write rewrites it only when a cited Source's version changed or a new Source cites the entity; when the section's current hash differs from the record (Gene edited it) or its bounds are broken, it is left alone and listed in the report ("The From sources section of <title> was edited, so it was left as it is."; our string).

### Filing states

On a batch **kept as Sources**, M27's states `idle | running | trial | done | failed` gain `entities` (the bulk pass finished; waiting for Gene) and `writing` (Write is running). The bulk pass (`_pass`, and `apply_external` after its trial) always ends in `entities`, even when no entity was found. Write ends in `done` (or `failed`, which Write can be run again from). On a batch not kept as Sources the states and behaviour are M27's.

### Routes (`backend/objectapp/api_import_agent.py` and `api_import.py`, T4 and T9)

| Route | Request | Response | Errors |
|---|---|---|---|
| `POST /api/import/preview`, re-preview (T4) | gains `keepAsSources?: bool` | the planned types show one type, Source, when on | as today |
| `POST /api/import/start`, v1 / MCP `start_import` (T4, T9) | gains `keepAsSources?: bool` (absent: the default rule) | as today | as today |
| `GET /api/import/batches/{id}/entities` (T9) | | `EntitiesView` | 404 no batch; 409 `"This import didn't keep its pages as Sources."` |
| `PUT /api/import/batches/{id}/entities/review` (T9) | `EntitiesReview` (without `revision`) | `{ok: true, view: EntitiesView}` | 404; 409 written already or not a Source batch; 422 `ReviewInvalid` (unknown id or status, empty rename, a merge across types, a split of names the entity doesn't have) |
| `POST /api/import/batches/{id}/entities/write` (T9) | `{}` | `202 {ok: true}` | 404; 409 another import running, a pass running, state not `entities`/`failed`-after-write, not a Source batch, or undecided entities ("N entities are still to decide.") |
| `GET /api/v1/import/entities?batch=` (T9) | | `EntitiesView` | 401/403 token; 404; 409 as above |

M27's proposal review route accepts an `edited` with `useType` and `category` (T7's offer); T9 widens its request model if it restricts `edited`.

### Pydantic (`api_import_agent.py`, `importers/model.py`) and TypeScript (`frontend/src/api/types.ts`)

```python
class EntityDecision(BaseModel): status: str; name: str | None = None
class SplitOp(BaseModel): id: str; names: list[str]
class EntitiesReviewRequest(BaseModel):
    decisions: dict[str, EntityDecision] = Field(default_factory=dict)
    merges: list[list[str]] = Field(default_factory=list)
    splits: list[SplitOp] = Field(default_factory=list)
# model.py: StartImportRequest and ImportPreviewRequest gain
#   keepAsSources: bool | None = None   # None: sources.keep_as_sources' default rule
```

```ts
// StartImportRequest and ImportPreviewRequest gain   keepAsSources?: boolean
// ImportBatch (history) gains                       keepAsSources?: boolean
export type FilingState = 'idle' | 'running' | 'trial' | 'entities' | 'writing' | 'done' | 'failed'
export type EntityStatus = 'accepted' | 'renamed' | 'rejected'
export interface EntityDecision { status: EntityStatus; name?: string }
export interface EntitiesReview {
  decisions: Record<string, EntityDecision>
  merges: string[][]
  splits: { id: string; names: string[] }[]
}
export interface SourceCite { path: string; title: string; quote: string }
export interface EntityValue {
  key: string; name: string; value: unknown; sources: SourceCite[]
  conflict: { value: unknown; sources: SourceCite[] }[] | null
}
export interface ImportEntity {
  id: string; typeId: string; type: string; name: string; aliases: string[]
  pages: { path: string; title: string }[]      // the Sources it is distilled from
  mainPages: string[]
  values: EntityValue[]
  summary: string[]                             // the "From sources" lines' text, without citations
  confidence: FilingConfidence
  joinedByAgent: boolean
  existing: { path: string; title: string } | null
  rule: 'own' | 'pages' | 'properties'
  decision: EntityDecision | null
}
export interface EntityLeftOut { id: string; type: string; name: string; pages: number; reason: 'text' | 'category' }
export interface EntitiesWritten {
  created: number; existing: number
  relations: number; plainLinks: number; relationsInbox: number
  sections: number; sectionsLeft: number; conflicts: number
  failed: { name: string; reason: string }[]
}
export interface EntitiesView {
  state: 'collecting' | 'review' | 'writing' | 'written'
  entities: ImportEntity[]          // by type name, then name
  leftOut: EntityLeftOut[]
  suggestedMerges: { ids: string[]; names: string[] }[]
  relations: { total: number; lowConfidence: number; plain: number }
  sources: number                   // the batch's Sources
  conflicts: number
  review: EntitiesReview
  undecided: number
  written: EntitiesWritten | null
}
// FilingStatus gains   keepAsSources: boolean
// FilingTrialItem gains:
//   mainEntity?: { type: string; name: string } | null
//   entities?: { type: string; name: string; ok: boolean }[]
// ProposalGroup gains:
//   offer?: { label: string; typeId: string; category: string } | null
// the proposal review's `edited` gains: useType?: string; category?: string
```

`EntitiesView.state`: `collecting` while the filing state is `idle | running | trial`, `review` in `entities`, `writing` in `writing`, `written` in `done` after a write.

### Client (`frontend/src/api/client.ts`) and mock (`frontend/src/test/mockApi.ts`)

```ts
importEntities(batchId: string): Promise<EntitiesView>                                  // GET .../entities
saveEntitiesReview(batchId: string, review: EntitiesReview): Promise<{ ok?: boolean; view: EntitiesView }>  // PUT .../entities/review
writeEntities(batchId: string): Promise<{ ok?: boolean }>                               // POST .../entities/write
// importPreview and startImport pass keepAsSources through unchanged
```

The mock answers an empty `EntitiesView` (`state: 'collecting'`, empty lists, `sources: 0`, `conflicts: 0`, `undecided: 0`, `written: null`).

### MCP (spec section 12, extended)

| Tool | Does |
|---|---|
| `import_entities(batch)` (read, new) | the batch's entity list with Gene's decisions, values with their Sources and conflicts (`EntitiesView`). Only the user accepts and writes entities, in Object. |
| `save_import_decisions(batch, decisions)` (exists) | decisions may carry `mainEntity`, `entities` (with `lines`), `relations` and `merges`, checked the same way |
| `start_import(...)` (exists) | gains `keepAsSources` (optional; defaults to on for every import) |

There is no tool to accept, merge, split or write entities, and no tool writes a Source.

### Strings

`frontend/src/import/agent/text.ts`, added to `AGENT_TEXT` by T1 (our strings: the catalog has no import wizard text):

```ts
entitiesHeading: 'Entities',
entitiesIntro: 'The things these pages talk about. The pages stay as read-only Sources, and each entity is built from all the Sources that mention it. Accept, rename, merge, split or turn down each one.',
entitiesNone: 'No entities were found. The pages stay as Sources.',
sourcesNote: (n: number) => `Built from ${pl(n, 'Source', 'Sources')}.`,
typeGroup: (type: string, n: number) => `${type} (${n})`,
sourcesCount: (n: number) => pl(n, 'source', 'sources'),
alsoCalled: (names: string[]) => `Also called ${names.join(', ')}`,
mainSubject: 'A page is about it',
alreadyHere: 'Already in this space',
joinedByAgent: 'Merged by the agent',
disagree: 'Sources disagree',
keptValue: (value: string, others: string[]) => `${value} kept, from the newer source; also ${others.join(', ')}`,
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
written: (w: { created: number; existing: number; relations: number; sections: number }) =>
  `${pl(w.created, 'object', 'objects')} created, ${w.existing} already here. ${pl(w.relations, 'link', 'links')} and ${pl(w.sections, '"From sources" section', '"From sources" sections')} written.`,
conflictsWritten: (n: number) => `${pl(n, 'value', 'values')} where Sources disagree: listed on the entity and in the report.`,
sectionsLeft: (n: number) => `${pl(n, '"From sources" section', '"From sources" sections')} you edited were left as they are.`,
relationsInbox: (n: number) => `${pl(n, 'low-confidence link', 'low-confidence links')} went to the Import inbox.`,
writeFailed: 'Writing stopped. What was written stays; Write again to finish.',
mainEntity: (type: string, name: string) => `About: ${type} ${name}`,
mentions: (names: string[]) => `Mentions: ${names.join(', ')}`,
```

`frontend/src/import/text.ts`, added by T12 (the label is the design's; the help is our string):

```ts
keepAsSources: 'Keep pages as Sources',
keepAsSourcesHelp: 'Every page is kept as a read-only Source, exactly as imported. With the AI filing pass, the things they talk about become their own objects, built from all the pages that mention them.',
```

### Prompt additions (`filing.build_prompt` on a batch kept as Sources, T8; our strings)

After M27's "Types you may choose" list: an "Entity types" list (every importable type of the space but Source: `- Host: category (label: Server | ...), ..., runs (shown from Application "Runs on")`, each relation property as `key → Target types`), then:

```
Every page is kept as it is, as a read-only source. Do not file the page itself: leave "type", "values" and
"links" empty. Instead list what the page is about and what it mentions (the user reviews the list before
anything is written); each thing is built from every page that mentions it:
- "mainEntity": the one thing the page is mainly about (a server page is about that Host; a runbook, script or
  prompt page is about that Runbook, Script or Prompt, named as the page); else null.
- "entities": things the page names that exist on their own (hosts, software per version, applications,
  locations, networks, people, vendors...): {"type", "name", "aliases", "values": [{"key", "value", "quote"}],
  "lines": [{"text", "quote"}], "confidence"}. Use the types listed; never make up a type.
  A category (Server, VM, Production) is a property value or a tag, never an entity. Every name and alias must be
  written in the page.
- "lines": at most three short sentences on what this page says about the thing, each with the quote it rests on.
- "relations": {"subject", "relation", "object", "quote", "confidence"}, relation being a relation property's name
  from the lists above (any other relation becomes a plain link); the quote must name both sides (the page's
  main subject may be left unnamed).
- "merges": names you know are the same thing, {"type", "names": [...]}.
- "tags" and "collections" go on the page's main entity.
```

### The skill (`importskill.TEXT`, T9)

The import stage gains: "Choose **Keep pages as Sources** (on by default for your import): every page is kept as a read-only Source, exactly as imported." Stage 5 gains the new fields with the entity rule verbatim from the Global Constraints, and "Pages stay read-only Sources; entities are distilled from all the Sources that mention them, and the newest Source wins when they disagree." The proposal stage gains, for an IT ops space: "Map documents onto an existing type first. A type whose properties match an existing type's is refused (use that type, with a category). Server, Workstation, VM or Production is a property value or a tag, never a type or an entity. Relations outside the named set become plain links." A new stage line after 6: "**Entities** (gate: the user reviews the entity list in Object): the user accepts, renames, merges, splits or turns down each entity and writes them; read it back with `import_entities(batch)`. Links from low-confidence candidates go to the Import inbox."

---

## Tasks

### Task 1: Contract, stubs and fixtures

**Files:**
- Create: `backend/objectapp/importers/entitycheck.py`, `entities.py`, `sources.py`, `distill.py`, `entitywrite.py` (stubs: the Contract's names, docstrings, constants, TypedDicts, dataclasses; functions raise `NotImplementedError`); `backend/tests/m30_helpers.py`; `backend/tests/test_m30_contract.py`
- Modify: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/test/mockApi.ts`, `frontend/src/import/agent/text.ts`

**Interfaces:**
- Consumes: M28 `Space.apply_setup("itops")` (the IT ops types with counterparts, the Source type and the entity types' `sources` → Distilled into); `basicsetup.source_type()`, `basicsetup.sources_property()`.
- Produces: everything in the Contract; `m30_helpers.itops_space(tmp_path) -> Path` (a copy of `space-sample` with `apply_setup("itops")`), `m30_helpers.make_itops_source(tmp_path) -> Path`, `m30_helpers.import_as_sources(space_root, source) -> str` (runs M25's import with `keepAsSources: true`, answers the batch; until T4 lands its tests are marked `xfail(strict=True)`), `m30_helpers.decisions(paths: dict[str, str]) -> dict` (the `FAKE_CLAUDE_FILING` JSON keyed by imported path), `m30_helpers.result(path, **checked) -> dict` (a filing result with checked candidates, for T3/T6 tests that skip the agent).

The synthetic source (`make_itops_source`; modified times set with `os.utime`): `Hosts/APP01.md` ("APP01 is the Payroll server at HQ. It runs Windows Server 2019. FQDN: app01.corp.example. IP address: 10.0.0.5.", modified 2026-10-01), `Hosts/SRV-DB01.md` (CRLF with a BOM: "SRV-DB01 holds the Payroll database on SQL Server 2019."), `Apps/Payroll.md` ("Payroll runs on APP01 and uses SQL 2019. Payroll backs up to SRV-DB01."), `Runbooks/Restart Payroll.md` ("Restart Payroll on APP01: stop the service, check SQL Server 2019, start it. Not APP010. `APP01` in code. See [[APP01]]."), `Notes/Rack notes.md` ("Rack 4 at HQ holds a Server and a VM."), `Notes/Old APP01 notes.md` ("APP01 IP address: 10.0.0.6.", modified 2025-06-01).

- [ ] **Step 1: Write the failing test** `test_m30_contract.py::test_contract_names`: the five modules import; `entitycheck.MIN_PAGES == 2`; `entities.STATUSES == ("accepted", "renamed", "rejected")`; `entities.REVIEW_FILE == "entities-review.json"`; `entitywrite.WRITTEN_FILE == "entities-written.json"`; `sources.SOURCE_READ_ONLY == "Imported source"`; `distill.SECTION_OPEN == "<!-- group from-sources -->"` and `distill.SECTION_HEADING == "## From sources"`; `Entity` has the Contract's fields; `make_itops_source` writes 6 files and `itops_space` has types named Host, Software, Application, Location, Runbook and Source, and Host has `sources` with counterpart key `distilledInto`.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_contract.py -q`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** the stubs, helpers, TS types, client methods, mock entries and strings exactly as in the Contract.
- [ ] **Step 4: Run** `uv run pytest backend/tests/test_m30_contract.py -q` and `cd frontend && npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `git add <the files above>` and `git commit -m "feat(m30): entity extraction contract, stubs and fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 2: Checking a decision's candidates

**Files:**
- Modify: `backend/objectapp/importers/entitycheck.py`
- Test: `backend/tests/test_m30_check.py`

**Interfaces:**
- Consumes: `filing._check_quote(doc, value, quote, kind)`, `filing._norm`, `filing._label_value`, `kinds.convert`, `planner.importable_type`, `Space._type_id`, `TypeDefinition.prop`, M29 `PropertyDefinition.synced`, M28 `options["counterpart"]` on relation definitions and `counterparts.find_relation` (imported from `filing` at module level; `filing` imports `entitycheck` only inside functions, so there is no cycle); `sources.SOURCE_TYPE_ID`.
- Produces: `check_candidates(...)` as in the Contract.

Rules (each failing item keeps `ok: False` and a `reason`; our texts):
- type: an importable type of the space, by name → `"no such type"`; the Source type → `"a Source is made by the import, not distilled"`.
- name: non-empty, and `filing._norm(name)` in `doc` → `"the name is not in the page"`.
- aliases: kept only when in `doc`; others dropped silently from `aliases` (not invented).
- values: as M27's `apply_decision` values loop against the entity's type; an `entity` kind → `"relations go in relations"`; `sources` → `"the import sets Sources"`; a synced property → `"synced; not filled by the import"`.
- lines: at most 3 per candidate (the rest dropped); `text` one line of 1-`MAX_LINE` characters → else `"a summary line is one short sentence"`; the quote passes `_check_quote(doc, quote, quote, "text")` → else its reason.
- `mainEntity`: any entity type; `main: True`. At most one; it is also a candidate for resolution.
- relations: the quote passes `_check_quote(doc, object, quote, "text")` and also contains the subject's name or one alias unless the subject is the page's main entity → `"the quote does not name both sides"`. `plain` is True when `relation` names neither a relation property of an importable type nor an M28 counterpart (`find_relation` finds nothing for any type pair); a plain relation is still ok.
- merges: at least two names, the type importable → else not ok.
- confidence: a candidate's own when in `CONFIDENCE`, else the decision's.

- [ ] **Step 1: Write the failing tests** in `test_m30_check.py` (space from `itops_space`, doc from `filing._doc_text` of the imported pages):
  - `test_valid_candidates_pass`: APP01's decision → `mainEntity` ok, `main: True`, type Host, values `fqdn = "app01.corp.example"` and `ipAddress = "10.0.0.5"` ok, its line "The Payroll server at HQ." ok; Payroll's relation `Payroll "Runs on" APP01` ok, `plain: False`; `"Uses"` with object "SQL 2019" ok; Restart Payroll's `mainEntity` Runbook "Restart Payroll" ok.
  - `test_invented_aliases_names_lines_relations_and_synced_values_refused` (Review Focus 6): alias "MSSQL 2019" (not in the page) is dropped; entity "Billing" (not in the page) has reason `"the name is not in the page"`; a line quoting "APP01 is in Denver" has the quote's reason; relation `SRV-DB01 "Runs on" APP01` quoted "Payroll runs on APP01" has `"the quote does not name both sides"`; a value for Host's synced "Last boot" has `"synced; not filled by the import"`; a value for `sources` has `"the import sets Sources"`; an entity of type Source has `"a Source is made by the import, not distilled"`.
  - `test_relation_outside_named_set_is_plain`: `Payroll "backs up to" SRV-DB01` is ok with `plain: True`.
  - `test_counterpart_name_accepted`: relation `APP01 "Runs" Payroll` is ok, `plain: False` (M28 counterpart name).
  - `test_confidence_defaults_to_decision`: a candidate without `confidence` in a `low` decision is `low`.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_check.py -q`. Expected: FAIL (`NotImplementedError`).
- [ ] **Step 3: Implement** `check_candidates(space, decision, doc, page_path, page_title) -> dict` by the rules above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): check entity candidates against their page` (with the trailer).

### Task 3: Resolution, values from all Sources, the entity rule and the review

**Files:**
- Modify: `backend/objectapp/importers/entities.py`
- Test: `backend/tests/test_m30_resolve.py`

**Interfaces:**
- Consumes: results shaped as T1's `m30_helpers.result` (T2's checked candidates); `distill.pick_values`, `distill.summary_lines` (T5; until T5 lands, the tests that need them use T1's helper `m30_helpers.simple_pick`, a reference implementation of the Contract's rule kept in the helper and deleted by T5's commit); `proposal.near_duplicates`, `proposal._squash`; `Space.list(type_id)` (titles, aliases); each page's `importSource.modified` (else `importedAt`) through `Space.read`; `batches.batch_dir`, `batches.write_json`; label options of every type's label properties; `Space.list("tag")` titles.
- Produces: `norm_name`, `resolve`, `Resolution`, `load_review`, `save_review`, `accepted`, `undecided`, `view`.

Algorithm (the order decides ids; the rest the tests pin):
1. `norm_name`: NFKC, casefold, whitespace collapsed, surrounding `.,;:()[]"'` stripped.
2. Collect every ok candidate (main and mentioned) from every non-rejected result, keyed `(typeId, norm_name)` for its name and each alias; union-find joins keys that share a candidate (a name and its aliases), then each ok agent merge's names within its type (`joinedByAgent = True` when a merge joined two groups that no name had joined).
3. Apply the review's `merges` (ids, in order), then its `splits` (the named spellings, with their candidates, leave to form a new entity). Ids are `"<typeId>:<min(keys)>"`, computed after each step; a decision keyed by an id that no longer exists is ignored (the merged entity keeps the decision of the id that survives; a split-off entity starts undecided).
4. Per entity: `name` the most-used spelling, `aliases` the rest; `pages` main pages first, then by path; `values = distill.pick_values(...)` over every passing value of every member, each with its page and the page's modified time; `lines = distill.summary_lines(...)`; `confidence` the highest; `existing` an object of the type in the space (never one of the Source type) whose `norm_name(title)` or an alias's is in `keys`.
5. `rule`: `"own"` when `mainPages`, else `"pages"` when `len(pages) >= MIN_PAGES`, else `"properties"` when `values`, else None. `category`: a key equals `norm_name` of a label option of any type in the space or of a tag's title. `rule is None or category` → `leftOut`.
6. `suggestedMerges`: within a type, `proposal.near_duplicates` over entity names (squashed form), never already joined.
7. `pages` of the Resolution: every page with a non-rejected result.

- [ ] **Step 1: Write the failing tests** in `test_m30_resolve.py`:
  - `test_names_and_aliases_merge_within_a_type`: "SQL Server 2019" (alias "SQL 2019") on SRV-DB01 and "SQL 2019" on Payroll → one Software entity, name "SQL Server 2019", aliases `["SQL 2019"]`, pages both, rule `"pages"`; a Host "Payroll" and an Application "Payroll" stay two entities.
  - `test_agent_merge_is_applied_and_offered_as_split`: merge `["MSSQL 2019", "SQL Server 2019"]` joins a third candidate; `joinedByAgent is True`.
  - `test_categories_and_single_mentions_are_left_out` (Review Focus 6): "Server" and "VM" (Host Category option, seed tag) → `leftOut` with `category`; "Rack 4" (one page, no values) → `leftOut`, rule None; "HQ" (two pages) is an entity.
  - `test_distilled_from_every_page`: APP01 is main on its own page and mentioned by Payroll, Restart Payroll and Old APP01 notes → one entity, rule `"own"`, `pages[0]` is its own page, the rest by path, its lines from its own page first.
  - `test_newest_source_wins_and_conflict_kept` (Review Focus 5): APP01's `ipAddress` is `10.0.0.5` (2026-10-01) with `conflict == [{"value": "10.0.0.6", "sources": [<Old APP01 notes, 2025-06-01>]}]`; after the test swaps the two modified times, `10.0.0.6` wins; the same FQDN from two pages is one value with two Sources and no conflict.
  - `test_existing_object_found`: a Host "app01" already in the space → `existing` is its path; the batch's own Source titled "APP01" is never `existing`.
  - `test_review_ops_and_ids`: `save_review` with a merge of two Software ids, a split of "SQL 2019" out, a rename and a turn-down → `resolve` reflects each; `accepted` returns `(entity, "New name")` for the rename; `undecided` lists the split-off id; `save_review` raises `ReviewInvalid` for an unknown id, status `"maybe"`, an empty rename and a merge across types; nothing but `entities-review.json` changes on disk.
  - `test_view_shape_and_reads_write_nothing`: `view(...)` matches `EntitiesView` (sorted by type then name, `undecided` count, `sources` = 6, `conflicts` = 1, `relations.lowConfidence` counting low relations or low sides, `relations.plain` = 1, each value's `sources` with titles and quotes) and the space's files and `.object/` are byte-identical after it.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_resolve.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions in `entities.py` by the algorithm.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): resolve entities from all their sources, the entity rule and Gene's review` (with the trailer).

### Task 4: Keep pages as Sources: the option, the type, read-only objects and re-runs

**Files:**
- Modify: `backend/objectapp/importers/sources.py`, `backend/objectapp/importers/model.py` (`keepAsSources` on the start and preview requests), `backend/objectapp/importers/planner.py` (`keep_as_sources`), `backend/objectapp/importers/writer.py` (`WriteState.keep_as_sources`, the Source type in the types phase, Category and System, `batch.json`; a re-run updating a Source), `backend/objectapp/api_import.py` (the default rule; passes the value to `plan` on preview, re-preview and start), `backend/objectapp/space.py` (`source_writes`; imported Sources read-only in summaries and in `_write`; `add_type`)
- Test: `backend/tests/test_m30_sources.py`

**Interfaces:**
- Consumes: M28 `basicsetup.source_type()`; M25 `plan`, `write_import`, `_types`, `_write_one` (the re-run update path), `provenance.BLOCK_KEY`; M27 `proposal.load_proposal`, `StartImportRequest.batch` / `requireApproved`; `Space._write`, `Space.type_by_id`, `ReadOnly`; M8 version history (`before_write`).
- Produces: `sources.keep_as_sources`, `ensure_source_type`, `category_for`, `system_label`, `is_imported_source`, `is_source_batch`; `plan(..., keep_as_sources)`; `Space.source_writes()`; `Space.add_type(t)`.

Rules:
- **The default** (`keep_as_sources(asked, require_approved, has_proposal)`): `asked` when not None, else **True for every import** (Gene, 2026-11-09: the box starts ticked for every import into a space; `require_approved` and `has_proposal` no longer change the default and are kept only for the report). `api_import` resolves it once per start, passes it to `plan` and the writer, and the writer records it in `batch.json`. Preview and re-preview take the same field (absent: False), so the planned types the wizard shows match what is written.
- **Planning** with `keep_as_sources`: every page (Markdown, Notion page or database row, document) is planned as type Source: its mapped type is neither created nor extended, its fields are planned as today but written as frontmatter keys that the Source type doesn't declare. Images and other files stay M25's Image/File objects (they are attachments, not pages). The mapping's type choices are kept in `batch.json` but unused.
- **Writing**: the writer's types phase calls `ensure_source_type` (the space's type with id `source` when there is one, whatever it holds; else `Space.add_type(basicsetup.source_type())`; one type file, once). Each Source gets `category = category_for(block, sourcePath)` and `system = system_label(block)`. It is written once, as M25 writes any object; nothing else in this milestone writes it.
- **Read-only**: an object whose type id is `source` and whose frontmatter has an `importSource` block is an **imported Source**. Its `ObjectSummary` has `readOnly: True`, `readOnlyReason: "Imported source"`, so the object page, views, `/api/v1` and MCP show it read-only with no other change. `Space._write` refuses it with `ReadOnly("Imported source")` unless the current thread is inside `source_writes()` (a thread-local depth counter). Move to Trash and Restore are allowed (they move the file; they don't edit it).
- `category_for(block, path)` (our table): by the original's (`block["original"]`, else `path`) extension: `.docx .doc .odt .rtf` Document; `.xlsx .xls .ods .csv` Spreadsheet; `.pptx .ppt .odp` Presentation; `.pdf` PDF; `.vsdx .vsd .drawio` Diagram; `.eml .msg` Email; `.html .htm .aspx` Web page; `.png .jpg .jpeg .gif .webp .heic` Image; otherwise by `block["system"]`: `wiki`, `notion`, `sharepoint` Wiki page; `obsidian`, `anytype`, `markdown`, `files` Note. Ticket and Chat are never set by these sources.
- **Re-run** (`writer._write_one`, the update of an object an earlier batch made): when that object is an imported Source, it is written inside `space.source_writes()` with history kept (not `history=False`), its `type`, `id`, `category` and `system` kept, and the rest of the frontmatter and the body exactly as the new import gives them; M25's "edited since import" check doesn't apply (a Source can't be edited in the app; a hand-edit outside it is in version history). An object that is a Source stays one whatever the re-run's option says. Every other re-run is unchanged.

- [ ] **Step 1: Write the failing tests** in `test_m30_sources.py` (the synthetic source imported through `create_app` and M25's routes):
  - `test_option_defaults_and_values` (Review Focus 3): `keep_as_sources(None, False, False) is True`, `(None, True, False) is True`, `(None, False, True) is True`, `(False, True, True) is False`, `(True, False, False) is True`; a plain start without the field keeps every page as a Source and `batch.json` has `keepAsSources: true`; a start with `keepAsSources: false` writes pages into their mapped types; with `keepAsSources: true` every page is a Source, no mapped type is created, and `batch.json` has `true`; a v1 `start_import` (`requireApproved`) without the field makes Sources; a re-preview with `keepAsSources: true` plans one type, Source.
  - `test_source_type_created_once_in_any_space`: in `space-sample` (no Source type) the first import kept as Sources writes `.object/types/source.json` equal to `source_type()` up to property ids, and a second such import writes no type; in `itops_space` it writes no type.
  - `test_source_is_byte_identical_to_the_import` (Review Focus 1): SRV-DB01's Source (CRLF+BOM) has `type` Source, `category` "Note", `system` "Markdown", in the Source folder; its body bytes equal the source file's body, BOM and CRLF kept; its page fields are frontmatter keys the Source type doesn't declare; the file's bytes equal what the writer wrote, checked again at the end of the test after the reads.
  - `test_imported_source_is_read_only` (Review Focus 1): `GET /api/object` of the Source answers `readOnly: true`, `readOnlyReason: "Imported source"`; `update_properties`, a body save, `rename_object`, `change_type`, `references.link_mention` and a `/api/v1` property write all raise or answer `"Imported source"`; the file's bytes are unchanged; adding an entity from the Source's "Distilled into" row (`POST /api/object/counterpart`) works, since it writes only the entity; an object of type Source without `importSource` is editable; Move to Trash and Restore work.
  - `test_source_writes_is_per_thread`: inside `source_writes()` this thread's `update_properties` works; another thread's, started inside it, is refused.
  - `test_category_for`: the table's cases, one per row.
  - `test_rerun_updates_source_with_history`: the test changes the source file's text and runs the re-run import (M25) → the Source's body is the new text byte for byte, its `type`, `id`, `category` and `system` kept; the M8 version history lists the previous bytes; a re-run with `keepAsSources: false` still updates it as a Source.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_sources.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** by the rules above.
- [ ] **Step 4: Run** the same command and `uv run pytest backend/tests -q -k "import or rerun or readonly or read_only or history or plan"`. Expected: PASS (every M25-M27 import test unchanged: the option is off for them).
- [ ] **Step 5: Commit** `feat(m30): keep pages as read-only Sources, an option on every import` (with the trailer).

### Task 5: Distillation: values, summary lines and the "From sources" section

**Files:**
- Modify: `backend/objectapp/importers/distill.py`; `backend/tests/m30_helpers.py` (delete `simple_pick`, point its users at `distill`)
- Test: `backend/tests/test_m30_distill.py`

**Interfaces:**
- Consumes: `entities.norm_name` (imported inside functions; `entities` imports `distill` at module level), `filing._norm`, `atomic_write`, `batches.write_json`.
- Produces: everything `distill.py` lists in the Contract.

Rules:
- `pick_values`: per key, values equal by `filing._norm(str(value))` are one value with every Source that says it; the winner is the value whose newest Source is the most recent (`modified`, None oldest); a tie goes to a main page's value, then the smallest path. Every other value is a `conflict` entry with its Sources. One value → `conflict: None`.
- `summary_lines`: lines equal by `norm_name(text)` merge their Sources; order: lines from main pages first, then by the newest Source, then text; at most `MAX_LINES`.
- `build_section`: `SECTION_OPEN`, `SECTION_HEADING`, a blank line, one `- <text> (<cites>)` per line (`cite(path)` per Source, joined with ", "), then when any value has a conflict a blank line, `DISAGREE_HEADING` and one `- <name>: <kept> (<cites>) or <other> (<cites>); <kept> kept, from the newer source.` per key (`label(key)` gives the property's name), then when any plain link a blank line and `ALSO_LINKED` with `[[...]] (<relation>)` items joined by ", ", then `SECTION_CLOSE`. No line is empty inside except the separators.
- `find_section`: the first line equal to `SECTION_OPEN` (spaces around ignored) and its matching `<!-- /group -->`, counting nested `<!-- group … -->` opens; the span includes both markers and one following blank line. An open with no matching close, or a second `SECTION_OPEN`, raises `SectionEdited`.
- `replace_section`: absent → the section and a blank line go before the first body line; present → when `recorded_hash` is given and differs from `section_hash` of the current span, `SectionEdited`; else the span is replaced. Bytes outside the span are never changed. The body's line endings are kept (`\r\n` bodies get `\r\n` lines).
- `save_record` / `load_record`: `.object/distilled/<id>.json`, atomic; a missing or unreadable file is None.

- [ ] **Step 1: Write the failing tests** in `test_m30_distill.py`:
  - `test_pick_values`: two equal FQDNs (one with different case) → one value, two Sources; `10.0.0.5` (2026) and `10.0.0.6` (2025) → 2026's wins, the other in `conflict`; equal times → the main page's; a None `modified` loses to any date.
  - `test_summary_lines_merge_and_cap`: the same sentence from two pages is one line with two Sources; 15 distinct lines → 12, main page's first.
  - `test_build_section_shape`: the Contract's example exactly (given `cite` and `label` stubs).
  - `test_replace_section_keeps_everything_outside` (Review Focus 2): on `"Gene's notes.\n"` the section goes on top and `"Gene's notes.\n"` follows unchanged; replacing it again with new lines changes only the span (bytes before and after identical); the same on a CRLF body with a BOM file read through `Space.read`; a body with a nested `<!-- group -->…<!-- /group -->` inside the section and another group after it: the inner one is replaced with the section, the one after is untouched.
  - `test_edited_or_broken_section_is_left_alone`: a recorded hash that differs from the current span → `SectionEdited`; an open marker without a close → `SectionEdited`; two open markers → `SectionEdited`.
  - `test_records_roundtrip`: `save_record` then `load_record` equal; nothing else written under `.object/`.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_distill.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** by the rules above.
- [ ] **Step 4: Run** it and `uv run pytest backend/tests/test_m30_resolve.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): distil values, summary lines and the From sources section` (with the trailer).

### Task 6: Writing distilled entities and relations

**Files:**
- Modify: `backend/objectapp/importers/entitywrite.py`
- Test: `backend/tests/test_m30_write.py`

**Interfaces:**
- Consumes: T1's `Entity`/`Resolution` (tests build them by hand or through `m30_helpers`, on a batch imported with `m30_helpers.import_as_sources`); T5's `build_section`, `replace_section`, `find_section`, `section_hash`, `load_record`, `save_record`, `SectionEdited`; `sources.is_imported_source`; `Space.create_object(type_id, title, values=...)` (applies the type's default template, M28's IT ops templates), `Space._write(..., stamp=False, history=False)` with `frontmatter.set_keys` for the `importSource` block (as `writer._file_object` does), `Space._write(path, version, edit)` (stamped, history kept) for the section, `Space.update_properties`, `Space.save_type` (adding `basicsetup.sources_property()`), `Space.ensure_id` (M29), `Space.resolve`, `Space._link_text`; M28 `counterparts.find_relation(types, subject_type_id, object_type_id, name) -> RelationMatch(source_type_id, property_key, reversed)` and `options["allowedTypes"]`; M28's `Space.counterparts(path)` for the assertions.
- Produces: `write_entities(...)` as in the Contract.

Order (each step recorded in `entities-written.json` before the next; a retry skips what is recorded). **No step writes a Source**: a write whose target is an imported Source is a bug, and the tests check every Source's bytes.
1. **Place.** `existing` → that path (`ensure_id` when it has no id). Else `create_object` with the final name, then the `importSource` block and the `items.json` entry of the Contract. A type without `sources` first gets `sources_property()` (one `save_type` per type, before its first entity).
2. **Relations.** For each relation in `res.relations`: resolve each side to a placed entity (by `(type, norm_name)`, else by name across types where exactly one fits), else `space.resolve(name, entity)` among objects that aren't Sources. Skip with a reason when a side is turned down, unknown, a Source, or the same object. Low confidence (the relation's or a side's) → `inboxLinks` (`"Link not written (low confidence): <subject> <relation> <object>"`, the subject entity's path), not written. Plain → a plain link on the subject (step 4). Else stored side by `find_relation` (subject's property, or the object's whose counterpart has that name); none fits → plain link.
3. **Values, aliases, Sources, tags, collections and stored relations.** Per placed path, one `update_properties`: for each picked value (never a synced property): the property is empty → the winner; its current value equals the record's `setByImport` and the winner changed → the winner; otherwise (Gene's value) left as it is. `aliases` the union (old first) of the entity's spellings, minus the title. `sources` the current refs plus every Source of the entity (main first), `{target, path}`, not repeated. Tags and collections: the passing ones of the pages it is the main entity of, added (never removed), plus "Import inbox" when one of its relations went to `inboxLinks`. Stored relation values append `{target: title, path}` when not there; a stored object that isn't an entity of this Write gets its own single write.
4. **Section.** `build_section` with the entity's lines, its picked values' conflicts and its plain links; `cite` gives the `link_mention` link text from the entity to the Source. Rewrite when there is no record, or a cited Source's version differs from the record's `cites`, or a Source cites it that the record doesn't list; else leave it. `replace_section` with the record's hash; `SectionEdited` → left alone, counted in `sectionsLeft` with the report text. Then `save_record` (values with `setByImport`, conflicts, the new hash and cites).

- [ ] **Step 1: Write the failing tests** in `test_m30_write.py` (an `itops_space` with the six pages imported as Sources, hand-built resolution):
  - `test_write_never_touches_a_source` (Review Focus 1): every Source's bytes are identical before and after a full write (entities, relations, plain links, inbox links, tags and collections from the decisions, sections); no Source has a new link, tag or collection.
  - `test_creates_accepted_entity_with_provenance_template_and_sources`: Software "SQL Server 2019" → a new object in the Software folder with aliases `["SQL 2019"]`, an `importSource` block `{system: "markdown", id: "entity:software:sql server 2019", batch}`, `sources` listing the SRV-DB01, Payroll and Restart Payroll Sources, the "From sources" section on top (each line citing its Sources as links that resolve to the Sources) and the M28 template's sections below it, and an `items.json` entry `action: "created", entity: true`; `Space.counterparts(<SRV-DB01 Source>)` has a "Distilled into" row listing it.
  - `test_relation_stored_on_one_side_and_counterpart_computed`: `Payroll "Runs on" APP01` writes `runsOn` on Payroll only; APP01's file has no `runsOn` or `runs` line; M28's `counterparts(APP01)` holds a row named "Runs" listing Payroll. `APP01 "Runs" Payroll` gives the same single stored line. `Payroll "backs up to" SRV-DB01` writes no property and an `Also linked: [[SRV-DB01]] (backs up to)` line in Payroll's section.
  - `test_conflict_listed_on_the_entity`: APP01's `ipAddress` is `10.0.0.5`; its section has the `Sources disagree:` line naming both values and both Sources; its record holds the conflict.
  - `test_gene_values_never_replaced` (Review Focus 5): Gene's Host "app01" with `ipAddress: 10.9.9.9` keeps it; a value the import set earlier and Gene didn't change is replaced when a newer Source says otherwise (second write with the modified times swapped); a synced property is never written.
  - `test_rerun_rewrites_only_the_section` (Review Focus 2): Gene's Host "app01" body `"My notes.\n"` → after the write the body is the section, a blank line and `"My notes.\n"`; Gene appends a line below; a second write after a cited Source changed rewrites only the section's bytes (diff); a third write with no Source changed writes nothing; after Gene edits a line inside the section, a write with a changed Source leaves the file as it is and counts `sectionsLeft: 1`.
  - `test_low_confidence_link_goes_to_inbox`: a `low` relation is not written; its subject entity is in the "Import inbox" collection and in `inboxLinks` with the reason text; no Source is in the collection.
  - `test_tags_and_collections_go_on_the_main_entity`: APP01's page decision tags "Backup" → the Host APP01 has the tag; the APP01 Source doesn't.
  - `test_mentions_in_sources_stay_unlinked`: after the write, the Restart Payroll Source still reads "Restart Payroll on APP01" with no link, and `unlinked_mentions(space, None, <Host APP01>)` lists it, as it lists a non-batch page of `space-sample` mentioning APP01.
  - `test_existing_object_is_reused_and_write_is_resumable` (Review Focus 4): with Gene's own Host "app01" in the space, the entity APP01 links to it, fills only its empty FQDN and adds no object; a write interrupted after the first placement (monkeypatched failure) and run again places nothing twice (object counts per type unchanged on the rerun).
  - `test_turned_down_side_skips_relation`: a relation to a turned-down entity is skipped with `"turned down"`.
  - `test_sources_property_added_to_other_types`: an accepted entity of a type without `sources` (a Page-like type made in the test) gets `sources_property()` on its type, one type save.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_write.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `write_entities(...)` by the order above.
- [ ] **Step 4: Run** the same command and `uv run pytest backend/tests/test_references.py backend/tests/test_references_m8.py -q` (unlinked mentions unchanged). Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): write distilled entities, Sources links and relations` (with the trailer).

### Task 7: Conventions in an IT ops space (the schema proposal)

**Files:**
- Modify: `backend/objectapp/importers/proposal.py` (M27's module)
- Test: `backend/tests/test_m30_conventions.py`

**Interfaces:**
- Consumes: M27's `_check_item`, `_squash`, `effective_item`, `apply`, `_save_props`, `_group`; `.object/space.json` `setup` (M28); M28's `counterpart` options; `Space.list("tag")`.
- Produces: `is_itops_space`, `named_relations`, `lookalike`, `LOOKALIKE_SHARE`, `OFFER`; proposal items with `offer`; `edited.useType` / `edited.category`.

Rules, only when `is_itops_space(space)` (M27's behaviour is otherwise unchanged; `test_m27_*` keep passing):
- **Existing types first / no look-alike**: a `create` item whose own properties (by `_squash(name)`, at least 2) are `>= LOOKALIKE_SHARE` among an existing type's own properties → problem `"It has the same properties as {type}."` and `offer = {"label": OFFER.format(type=<type name>), "typeId", "category": <the item's group name>}`.
- **Categories are never types**: a `create` whose squashed name is a label option of a type in the space (or a tag's title) → problem `"{name} is a category: a property value or a tag, not a type."`, with the offer for the type holding that option (none for a tag).
- **Named relations**: an `entity` property whose name is not in `named_relations(space)` is dropped with `"Not one of the named relations; it stays a plain link."`.
- An item with a problem can't be applied (M27's `apply` already skips it).
- **The offer**: a decision `{status: "edited", edited: {useType, category}}` makes `effective_item` an `extend` of `useType` whose Category label (else Kind) gains `category` as an option when missing (one type save at Apply, through `_save_props`); a type with neither label is a plain `use`. `_group` carries `offer`.

- [ ] **Step 1: Write the failing tests** in `test_m30_conventions.py`:
  - `test_lookalike_type_refused_with_offer` (Review Focus 7): in `itops_space`, a proposal `create "Server"` with properties IP address, FQDN, Operating system, Environment (10 documents) → problem `"It has the same properties as Host."`, `offer == {"label": "Use Host, with a category", "typeId": "host", "category": "Server"}`; `apply` skips it and creates no type.
  - `test_category_name_refused`: `create "VM"` (a seed tag) → the category problem, no offer; `create "Workstation"` → the category problem and the Host offer.
  - `test_offer_applied`: `create "Kiosk"` (Host's properties) with the review `{status: "edited", edited: {useType: "host", category: "Kiosk"}}` → `apply` adds "Kiosk" to Host's Category options and creates no type; run again: nothing changes.
  - `test_relations_outside_named_set_dropped`: an `extend` of Application with `Runs on` and `Backs up` relations → `Runs on` kept, `Backs up` dropped with the reason.
  - `test_rules_off_outside_itops` (Review Focus 7): the same proposals in `space-sample` → exactly M27's problems and properties.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_conventions.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** by the rules above.
- [ ] **Step 4: Run** it and `uv run pytest backend/tests/test_m27_agent.py backend/tests/test_m27_fixes.py -q -k proposal`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): IT ops conventions as hard rules in the schema proposal` (with the trailer).

### Task 8: The filing pass on a batch kept as Sources

**Files:**
- Modify: `backend/objectapp/importers/filing.py`
- Test: `backend/tests/test_m30_filing.py`

**Interfaces:**
- Consumes: T2 `check_candidates`, T3 `resolve` / `load_review` / `save_review` / `accepted` / `undecided` / `view`, T4 `sources.is_source_batch`, T6 `write_entities`; M27's `Filing`, `apply_decision`, `_normalise_suggestions`, `_inbox_items`, `_to_inbox`, `record_accuracy`, `_swap`.
- Produces: the Contract's states and `Filing.entities_view`, `save_entity_review`, `write_entities`; `status()` gains `keepAsSources`, and its trial items gain `mainEntity` and `entities`.

Changes, **only when `is_source_batch`** (a batch not kept as Sources runs exactly as M27; `test_m27_agent.py` and `test_m27_fixes.py` pass unchanged):
- `build_prompt` gains the Contract's prompt additions; `_types_for_prompt` also answers the entity types list (without Source).
- `apply_decision` **writes nothing**: it reads the page, records the M27 checks of `tags` and `collections`, stores `check_candidates(...)` in the result for every allowed page (inbox pages included), marks low confidence in the result (its candidates count as low), and records the decision's `type`, `values` and `links` with the note `"Pages stay Sources; the page's own type, values and links are not applied."` when any is given. It never calls `change_type`, `update_properties` or `_to_inbox` on a page. A rejected page gets no candidates.
- `eligible` skips `items.json` entries with `entity: true`.
- The end of `_pass` (bulk) and of `apply_external` (after the trial): state `entities`. M27's links pass is not run (relations replace it).
- `write_entities(batch)`: `NotAllowed` on a batch not kept as Sources; `Busy` when a pass runs; `NotAllowed` unless state is `entities` (or `failed` with `mode == "entities"`) and `undecided` is empty (`"N entities are still to decide."`); state `writing`, mode `entities`; a worker thread runs T6's `write_entities` with the batch's `source.system` and `importedAt`, saves `items.json`, adds the `inbox.json` rows for `inboxLinks` (entity paths), then `_finish`: M27's normalise suggestions over the written entities' paths, `done`, accuracy and the report. A failure records `failed` with the error and keeps what was written.
- The report (`record_accuracy` or a sibling called by `_finish`) writes `## Entities`: `- Sources: S pages kept as Sources`, `- Entities: A accepted (C created, E already in the space), T turned down, L not made into objects`, `- Links written: R; plain links: P; to the Import inbox: I`, `- From sources sections: W written, K left as they are (edited by you)`, then `### Sources disagree` with one `- <entity>: <property> <kept> (<Sources>) / <other> (<Sources>); kept <kept>` per conflict, and one line per section left alone.

- [ ] **Step 1: Write the failing tests** in `test_m30_filing.py` (fake `claude` with `FAKE_CLAUDE_FILING` from `m30_helpers.decisions`, through `create_app` and the M27 routes as `test_m27_agent.py` does, the import started with `keepAsSources: true`):
  - `test_pass_and_trial_write_nothing` (Review Focus 1): proposal (use Host, Application, Software, Runbook) applied, import, trial (all six pages), marks, continue → `GET .../filing` state `entities`, `keepAsSources: true`; trial items carry `mainEntity {type: "Host", name: "APP01"}` and `entities`; every `.md` file and type file is byte-identical to before the trial; only `.object/imports/<batch>/` changed.
  - `test_write_needs_every_entity_decided`: `fil.write_entities` raises `NotAllowed` with `f"{n} entities are still to decide."` (n from the view); after decisions it runs to `done`, with the report's `## Entities` lines, the `### Sources disagree` line for APP01's IP address and the `## AI filing` section intact; every Source's bytes are as imported.
  - `test_no_entities_still_finishes`: decisions without the new fields → state `entities`, the view has no entities and `sources: 6`; Write → `done`, nothing written but the records and the report.
  - `test_batch_not_kept_as_sources_runs_as_m27`: the same import with `keepAsSources: false` → the pass ends in `done` as M27 (pages filed, inbox, report); `entities_view`, `save_entity_review` and `write_entities` raise `NotAllowed`.
  - `test_rerun_and_second_write_create_nothing_new` (Review Focus 4): a second `write_entities` is `NotAllowed`; re-importing the same source with one page's text changed and running its pass and write adds no Host, Software, Application or Source object (entities are `existing`, the Source is updated by the re-run with its old text in version history) and rewrites only the "From sources" sections citing the changed Source.
  - `test_trash_batch_takes_sources_and_created_entities_only` (Review Focus 8): `batches.trash_batch` trashes the batch's Sources and the created Software and Location; Gene's pre-existing Host "app01" is not trashed; restoring the Trash items brings the Software and a Source back, the Source still read-only and byte-identical.
  - `test_low_confidence_page_keeps_its_source_out_of_the_inbox`: a `low` decision for APP01's page → its Source is not in any collection; APP01 is still created when accepted (from the other pages' mentions) and its low relations put it in the Import inbox.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_filing.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** `uv run pytest backend/tests/test_m30_filing.py backend/tests/test_m27_agent.py backend/tests/test_m27_fixes.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): the filing pass collects entities from Sources and writes them after review` (with the trailer).

### Task 9: Routes, the MCP tools and the skill

**Files:**
- Modify: `backend/objectapp/api_import_agent.py`, `backend/objectapp/api_v1_tools.py` (the entities read, `start_import`'s `keepAsSources`), `backend/objectapp/mcp_server.py`, `backend/objectapp/toolcatalog.py`, `backend/objectapp/importfiling.py` (`_IMPORT_TOOLS` gains `"import_entities"`), `backend/objectapp/importskill.py`, the catalogue count tests that list `OBJECT_READ` (`backend/tests/test_m17_contract.py`, `test_m17_mcp_tools.py`, and any other the full run names)
- Test: `backend/tests/test_m30_api.py`

**Interfaces:**
- Consumes: T8's `Filing` methods; `filing.Busy`, `filing.NotAllowed`, `entities.ReviewInvalid`; `Jobs.running()`; T4's `keepAsSources` on `StartImportRequest`; T7's `edited.useType` / `edited.category`.
- Produces: the Contract's routes, `import_entities` tool, `start_import`'s `keepAsSources`, docstring of `save_import_decisions` listing the new fields, the proposal review model's `useType` / `category`, the skill text.

- [ ] **Step 1: Write the failing tests** in `test_m30_api.py`:
  - `test_entities_routes`: on a batch kept as Sources, `GET .../entities` answers `EntitiesView` with `state: "review"`; `PUT .../entities/review` with an unknown id → 422; with valid decisions → `{ok: true, view}` with `undecided: 0`; `POST .../entities/write` → 202, then polling `GET .../filing` reaches `done` and `GET .../entities` has `state: "written"` and `written.created >= 1`; a second POST → 409; an unknown batch → 404 on all three; a batch not kept as Sources → 409 `"This import didn't keep its pages as Sources."` on all three.
  - `test_write_refused_while_import_runs`: with `jobs.running()` true → 409 `"Another import is running."`.
  - `test_reads_write_nothing`: the space's `.md` files and `.object/imports/<batch>/` are byte-identical after `GET .../entities`, `GET /api/v1/import/entities` and `GET .../filing`.
  - `test_mcp_start_import_keeps_sources_by_default`: the MCP `start_import` without `keepAsSources` records `keepAsSources: true` in `batch.json`; with `false`, `false`.
  - `test_proposal_offer_roundtrip`: in an IT ops space, `GET` of the proposal shows the look-alike item's `offer`; `PUT` of the review with `edited: {useType: "host", category: "Kiosk"}` is accepted and Apply adds the option.
  - `test_mcp_import_entities_is_read_only`: `"import_entities"` is in `toolcatalog.OBJECT_READ`, not in `OBJECT_WRITE`; the MCP server lists it; there is no tool whose name contains `entit` or `source` among write tools; a filing run's allowed tools exclude it (`importfiling.filing_tools`).
  - `test_skill_states_the_rules`: `importskill.TEXT` contains "Keep pages as Sources", "exists on its own", "more than one page", "properties of its own", "never entities", "read-only Sources", "newest Source wins", "Use", "with a category" and "import_entities(batch)".
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes (the Contract's status codes and texts), the v1 routes (read token for the entities read), the MCP tool (`annotations=READ`) and `start_import`'s field, the catalogue entries, the proposal review model and the skill text.
- [ ] **Step 4: Run** `uv run pytest backend/tests/test_m30_api.py backend/tests/test_m17_contract.py backend/tests/test_m17_mcp_tools.py backend/tests/test_m27_agent.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): entities routes, the import_entities tool and the skill` (with the trailer).

### Task 10: The Entities step

**Files:**
- Create: `frontend/src/import/agent/EntitiesStep.tsx`, `frontend/src/import/agent/entities.test.tsx`, `frontend/src/editor/fromSources.m30.test.ts`

**Interfaces:**
- Consumes: T1's `api.importEntities`, `saveEntitiesReview`, `writeEntities`, `api.filingStatus`; `AGENT_TEXT`; `agentTiming.pollMs` from `TrialStep`; the editor's annotation parser and document round trip (`editor/annotations.ts`, read only).
- Produces: `export function EntitiesStep({ batch, onDone }: { batch: string; onDone: (status: FilingStatus) => void })`.

Layout, in ProposalStep's style: heading `entitiesHeading` (`id="entities-heading"`, `tabIndex={-1}`), intro, `sourcesNote`; **These look like the same thing** rows with **Merge**; one group per type (`typeGroup`), each row a checkbox (`selectLabel`), the name, `sourcesCount`, `alsoCalled`, the badges (`mainSubject`, `alreadyHere`, `joinedByAgent`, `disagree`, Low confidence), the first summary line, the first value with its Sources and quote (and `keptValue` when it has a conflict), the status, and **Accept** / **Rename** (an inline `renameLabel` field) / **Turn down** / **Split** (when it has aliases: the spellings as checkboxes under `splitIntro`); **Merge N selected** per type when two or more are selected; **Not made into objects** collapsed, each with its `leftOutReason`; footer `undecidedEntities`, **Accept the rest**, **Write** (disabled while anything is undecided). Every change saves the whole review and shows the view the server answers. Write polls `filingStatus` every `agentTiming.pollMs` until `done` (then the `written`, `conflictsWritten`, `sectionsLeft` and `relationsInbox` lines that apply, and **Continue**, which calls `onDone(status)`) or `failed` (`writeFailed`, Write enabled again).

- [ ] **Step 1: Write the failing tests** in `entities.test.tsx` (mock API, `agentTiming.pollMs = 10`):
  - `groups entities by type with counts and badges`: two Software, one Host → headings "Software (2)", "Host (1)", "2 sources", "Also called SQL 2019", "A page is about it", "Already in this space", "Sources disagree", and "Built from 6 Sources."
  - `accept, rename and turn down save the review`: each click calls `saveEntitiesReview` with the decision (`{status: 'renamed', name: 'SQL Server 2019 Std'}` after Rename and Enter).
  - `merge selected and split send their ops`: selecting two rows and **Merge 2 selected** sends `merges: [[id1, id2]]`; **Split** with "SQL 2019" checked sends `splits: [{id, names: ['SQL 2019']}]`; the suggested merge's **Merge** sends its ids.
  - `write waits for every decision`: Write is disabled with "1 entity still to decide"; **Accept the rest** accepts it; Write calls `writeEntities`, shows "Writing…", and on `done` shows the written line, the conflicts line and **Continue**, which calls `onDone`.
  - `no entities still offers Write`: an empty view shows `entitiesNone` and an enabled Write.
  - `a failed write can be run again`: status `failed` shows `writeFailed` and enables Write.
  - `left-out entities are listed with their reason`.
  - `fromSources.m30.test.ts`: the annotation parser reads `<!-- group from-sources -->` as a group open keeping the `from-sources` option's raw text, and a document holding the Contract's example section loads and serialises back byte for byte.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/import/agent/entities.test.tsx src/editor/fromSources.m30.test.ts`. Expected: FAIL (the step); the annotation test may already pass, which confirms the section format (if it fails, stop and report: T5's markers would then need another form).
- [ ] **Step 3: Implement** `EntitiesStep`.
- [ ] **Step 4: Run** the same command and `npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(m30): the import wizard's Entities step` (with the trailer).

### Task 11: The Entities step in the agent flow, the trial's entity lines and the proposal's offer

**Files:**
- Modify: `frontend/src/import/agent/AgentFlow.tsx`, `frontend/src/import/agent/TrialStep.tsx`, `frontend/src/import/agent/ProposalStep.tsx`, `frontend/src/import/agent/agent.test.tsx`

**Interfaces:**
- Consumes: T10's `EntitiesStep` (until T10 lands, the test mocks `./EntitiesStep` with a stub rendering the heading "Entities" and a Continue button); T1's `FilingStatus` states and `keepAsSources`, `ProposalGroup.offer`.
- Produces: `Stage = 'proposal' | 'trial' | 'entities' | 'normalise' | 'done'`.

- [ ] **Step 1: Write the failing tests** in `agent.test.tsx`:
  - `trial status entities goes to the Entities step`: a filing status `entities` after Continue with the rest → the Entities heading shows; its Continue (status `done` with normalise suggestions) → Normalise with those suggestions.
  - `done without Sources skips the step`: status `done` with `keepAsSources: false` → Normalise directly (M27's path).
  - `a reopened dialog in entities state resumes there`: TrialStep's first load answering `entities` calls `onDone`.
  - `trial items show main entity and mentions`: an item with `mainEntity {type: 'Host', name: 'APP01'}` and two entities shows "About: Host APP01" and "Mentions: SQL Server 2019, HQ" (only `ok` ones).
  - `polling stops in entities and writing`: TrialStep polls in `running`, not in `entities` or `writing` (EntitiesStep owns that).
  - `the proposal offers the existing type`: a group with `offer {label: 'Use Host, with a category', typeId: 'host', category: 'Server'}` and a problem shows a button "Use Host, with a category"; clicking it saves `{id, status: 'edited', edited: {useType: 'host', category: 'Server'}}`; a group without `offer` shows none.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/import/agent/agent.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**: `AgentFlow` routes `onDone(s)` to `entities` when `s.state === 'entities'`, else `normalise`; `TrialStep` treats `entities` like `done` for `onDone` and stops polling; the item lines; ProposalStep's offer button (the group's problems stay shown above it).
- [ ] **Step 4: Run** `npx vitest run src/import/agent` and `npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(m30): Entities between Trial and Normalise, and the proposal's offer` (with the trailer).

### Task 12: The "Keep pages as Sources" option in the import wizard

**Files:**
- Modify: `frontend/src/import/ImportOptions.tsx` (the checkbox), `frontend/src/import/ImportDialog.tsx` (state, default, passed to re-preview and start), `frontend/src/import/text.ts` (the two strings)
- Create: `frontend/src/import/keepAsSources.m30.test.tsx`

**Interfaces:**
- Consumes: T1's `keepAsSources` on `StartImportRequest` / `ImportPreviewRequest`; `api.importPreview`, `api.startImport`.
- Produces: `ImportOptions` props `keepAsSources: boolean`, `onKeepAsSources(next: boolean): void`.

The checkbox "Keep pages as Sources", with `keepAsSourcesHelp` under it, sits in Import options for every source kind and target. It starts **checked** for every import (Gene, 2026-11-09); unchecking sends `keepAsSources: false`.

- [ ] **Step 1: Write the failing tests** in `keepAsSources.m30.test.tsx` (mock API):
  - `on by default for every import`: the review step shows the checked "Keep pages as Sources" with its help; Start sends `keepAsSources: true`.
  - `on sends true and re-previews`: checking it calls `importPreview` with `keepAsSources: true` and shows the line under the mapping; Start sends `keepAsSources: true`.
  - `unchecking sends false`: unchecking the box and starting sends `keepAsSources: false`; the re-preview shows the mapped types again.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/import/keepAsSources.m30.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/import` and `npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(m30): Keep pages as Sources in the import wizard` (with the trailer).

### Task 13: Integrate: acceptance and docs

**Files:**
- Create: `scripts/m30_acceptance.py`, `docs/superpowers/plans/m30-acceptance.md`
- Modify: `docs/behavior-catalog.md` (the import options: Keep pages as Sources; the agent steps: an **Entities** bullet after Trial, read-only Sources, the "From sources" section, the `import_entities` tool in the MCP bullet, the IT ops proposal rules), `docs/superpowers/plans/remaining-work.md`, `CONTINUE.md`

**Interfaces:**
- Consumes: everything above; M27's `scripts/m27_acceptance.py` structure (temp `OBJECT_STATE_DIR` / `OBJECT_CACHE_DIR`, fake `claude`, `check(name, ok)`, `RESULT: PASS`).

`m30_acceptance.py` copies `space-sample` into a temp folder itself, applies the IT ops setup, adds Gene's own Host "app01" (body "My notes.", `ipAddress: 10.9.9.9`), writes the synthetic source (`m30_helpers.make_itops_source`), and runs, through `create_app` and the fake `claude`: a plain import without the option into a scratch copy (pages in their mapped types, `keepAsSources: false`); then on the main copy: draft batch and scan → proposal (use Host, Application, Software, Runbook; plus a `create "Server"` with Host's properties, which shows the problem and the offer "Use Host, with a category" and is not applied) → review → Apply → import with `keepAsSources: true` (six Sources, read-only, hashes recorded) → trial (6 pages; no `.md` changed) → marks → continue → `entities` state → checks the view (SQL 2019 and SQL Server 2019 one entity; "Server" and "VM" categories left out; "Rack 4" stays text; APP01 distilled from four pages with the IP conflict; `sources: 6`) → review (accept, rename one, turn down one, merge a suggested pair, split one) → Write → `done`. It then checks: every Source is byte-identical to its recorded hash, and a property edit on one answers "Imported source"; the created entities and their provenance; Gene's "app01" was reused, keeps `ipAddress: 10.9.9.9` and "My notes." below its new "From sources" section; the section's lines cite Sources as links and list the IP conflict; each entity's `sources` lists its Sources and each Source's "Distilled into" row lists its entities; Payroll stores "Runs on" APP01 and APP01's counterpart row "Runs" lists Payroll; "backs up to" is a plain link in Payroll's section; the Restart Payroll Source's mentions of APP01 are unlinked and listed under APP01's unlinked mentions; the low-confidence link's subject entity is in the Import inbox and no Source is; a non-batch page's unlinked mention of APP01 is still listed; the report lists the conflict; `GET` of the entities view wrote nothing; a re-run with one changed page updates its Source (old text in version history) and rewrites only the sections citing it; Move batch to Trash trashes the Sources and created entities and not Gene's object; the fixture folder is unchanged (hash before and after). Ends with `RESULT: PASS`.

- [ ] **Step 1: Write** `scripts/m30_acceptance.py` and run `uv run python scripts/m30_acceptance.py`. Expected: `RESULT: PASS`.
- [ ] **Step 2: Write** `m30-acceptance.md` with Gene's hand-checks:
  - [ ] The import wizard's options show "Keep pages as Sources", off for a plain import; an import with it off files pages into their mapped types as before.
  - [ ] On a copy of a space with the IT ops starter, import a synthetic folder of server, application and runbook pages with "Keep pages as Sources" on: every page is a Source, read-only ("Imported source"), with its text exactly as in the folder and its Category and System.
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
  - [ ] An outside agent over MCP can read the list with `import_entities` and cannot accept or write it, nor edit a Source; its `start_import` keeps pages as Sources unless told not to.
  - Deviations: (filled in by the build).
- [ ] **Step 3: Run the gate**: `uv run pytest backend/tests -q`, `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`, and `uv run python scripts/m27_acceptance.py`, `scripts/m28_acceptance.py` and `scripts/m30_acceptance.py`. Expected: all pass (M27's unchanged: its imports keep the option off).
- [ ] **Step 4: Update** the catalog, `remaining-work.md` (M30 built; Gene's checks) and `CONTINUE.md`.
- [ ] **Step 5: Commit** `test(m30): acceptance, hand-checks and docs` (with the trailer).

---

## Shared files and ordering

| Shared file | Owner | Others needing a change say so in their report |
|---|---|---|
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `import/agent/text.ts` | T1 | T10, T11, T12 |
| `backend/tests/m30_helpers.py` | T1, then T5 (removes `simple_pick`) | T2-T4, T6-T9, T13 read it |
| `backend/objectapp/importers/entitycheck.py` | T1 (stub), then T2 | |
| `backend/objectapp/importers/entities.py` | T1 (stub), then T3 | |
| `backend/objectapp/importers/sources.py` | T1 (stub), then T4 | |
| `backend/objectapp/importers/distill.py` | T1 (stub), then T5 | |
| `backend/objectapp/importers/entitywrite.py` | T1 (stub), then T6 | |
| `backend/objectapp/space.py`, `api_import.py`, `importers/model.py`, `importers/planner.py`, `importers/writer.py` | T4 | T6, T8 read them, never edit |
| `backend/objectapp/importers/proposal.py` | T7 | T3 reads `near_duplicates`, `_squash` |
| `backend/objectapp/importers/filing.py` | T8 | T2 reads its helpers, never edits it |
| `backend/objectapp/api_import_agent.py`, `api_v1_tools.py`, `mcp_server.py`, `toolcatalog.py`, `importfiling.py`, `importskill.py`, the catalogue count tests | T9 | |
| `frontend/src/import/agent/EntitiesStep.tsx`, `entities.test.tsx`, `frontend/src/editor/fromSources.m30.test.ts` | T10 | |
| `frontend/src/import/agent/AgentFlow.tsx`, `TrialStep.tsx`, `ProposalStep.tsx`, `agent.test.tsx` | T11 | |
| `frontend/src/import/ImportOptions.tsx`, `ImportDialog.tsx`, `import/text.ts`, `keepAsSources.m30.test.tsx` | T12 | |
| `docs/behavior-catalog.md`, `remaining-work.md`, `CONTINUE.md` | T13 | |

`batches.py`, `references.py`, `basicsetup.py`, `counterparts.py`, `editor/annotations.ts`, every M27 test and acceptance script, and every other M28/M29 file are used, not edited. If a task finds it must edit one, it stops and reports.

## Lanes

T1 runs first, alone. Then seven tracks (counted from the Files lists; no file is in two tracks):

| Track | Tasks, in order | Waits for |
|---|---|---|
| B1 (checks and the pass) | T2, T8 | T8 waits for T3 (B2), T4 and T6 (B3) and T7 (B4) |
| B2 (resolution and routes) | T3, T9 | T9 waits for T8 (B1) |
| B3 (Sources and writing) | T4, T6 | T6 waits for T3 (B2) and T5 (B4) |
| B4 (distillation and conventions) | T5, T7 | |
| F1 (the step) | T10 | |
| F2 (the flow and the offer) | T11 | nothing: its test stubs `EntitiesStep` until T10 lands |
| F3 (the wizard option) | T12 | nothing: tests use T1's types and the mock API |

On a 4-CPU box this runs as about four parallel agents (the front-end tracks are short). T13 integrates after all tracks. Then one whole-milestone review (correctness, file safety, fidelity to the spec), one fix pass, the final gate (T13 step 3), and Gene's hands-on check.

## Our calls

1. **Candidates come from the filing pass**, so the Entities step sits **after the bulk pass, before Normalise** (the spec puts it "after the schema step"; it can't come earlier, because the candidates don't exist until the pages are read). The trial shows each page's main entity and mentions, so Gene can mark those right or wrong too.
2. **Keep pages as Sources** (Gene, 2026-11-09) is `keepAsSources` on the import's preview and start requests, recorded in `batch.json`. **Default: on for every import** (Gene's decision, 2026-11-09: the box starts ticked for every import into a space, plain mapped imports included); a caller or the wizard sends `false` to file pages into their mapped types.
3. **On a batch not kept as Sources the AI filing pass is M27's, unchanged** (pages filed into types, no Entities step), so M27's tests and acceptance stay as they are. Entity extraction and distillation need Sources to cite.
4. **What becomes a Source**: every page (Markdown, Notion pages and rows, documents). Images and other files stay M25's Image and File objects, since they are attachments rather than pages. A page's fields are kept as frontmatter keys that the Source type doesn't declare, so Source never collects a long list of unrelated properties; the filing pass still reads them.
5. **A Source's text is byte-identical to the imported text** (Gene, 2026-11-09): no mention links, tags, collections or inbox entries are written to it. The decision's tags and collections go on the page's main entity, and a low-confidence link puts its **subject entity** in the Import inbox (never a Source). Mentions of an entity in Sources stay unlinked and show under its unlinked mentions. The entity links to its Sources through its "From sources" citations and the Sources relation.
6. **Read-only** is `ObjectSummary.readOnly` with the reason "Imported source", enforced in `Space._write`, so every route, v1, MCP, agents and automations refuse it with no per-route code. Only the M25 re-run writes a Source, inside `Space.source_writes()` (per thread), keeping the previous text in version history. **Move to Trash and Restore stay allowed.** A Source stays a Source on a re-run whatever the re-run's option says.
7. **The Source type is the type with id `source`**: M28's in an IT ops space; created from `basicsetup.source_type()` by the first import kept as Sources elsewhere. A space whose `source` id is already some other type uses that type.
8. **Category** is set from the original file's format, then the source system (the table in T4); Ticket and Chat are never set by today's sources. **System** maps `importSource.system` to its label.
9. **`mainEntity` means "mainly about"**: that entity's Sources list starts with this page's Source, its summary lines come first, its values win ties on equal modified times, and the page's tags and collections go on it. It never makes the page into the entity. A runbook, script or prompt page is mainly about itself (a Runbook, Script or Prompt named as the page), so those types get objects from an import too. On a Source batch the decision's own `type`, `values` and `links` are not applied (a note says so); the agent puts them on `mainEntity`.
10. **Per-value citations live in a sidecar**, `.object/distilled/<entity id>.json` (and the batch records), not in the frontmatter: a `sources` frontmatter map would clash with the Sources relation's key and churn the file on every re-run. One file per entity, so a rename or type change never orphans it. The sidecar is not exported in this milestone (the section's citations are in the `.md` file). **No object-page UI for per-value citations** in this milestone: they show in the Entities step, the API and `import_entities`; the conflicts show in the "From sources" section.
11. **The section's bounds are M7's group container**, `<!-- group from-sources -->` … its matching `<!-- /group -->`, so the editor keeps and shows it as one block; T10 checks that the editor round-trips it. It sits at the top of the body. **A section Gene edited is never rewritten** (its hash differs from the record): it is left alone and reported. A rewrite happens only when a cited Source's version changed or a new Source cites the entity.
12. **Summary lines come from the filing pass, per page** (`lines`, at most 3 per candidate, each quoted), and the app assembles them: merged when equal, main page first, then newest Source, at most 12. No extra agent run builds the summary.
13. **Conflicts**: values equal after normalising are one value with several Sources, not a conflict. The newest Source (`importSource.modified`, else `importedAt`) wins; the conflict is listed in the report and as a "Sources disagree:" line in the section. **The import never replaces a value Gene set**: it fills empty properties and replaces only values it set itself (`setByImport`), never synced ones.
14. **Relations outside the named set become plain links in every space** (an "Also linked:" line in the subject's section), not only in an IT ops space, so a relation is never thrown away.
15. **The IT ops conventions** (T7) apply when the space's setup is `itops` or it has the Host, Software and Application types. A look-alike is a new type with at least two properties, 80% or more of them (by name) also an existing type's. "Use <type>, with a category" turns the item into an extend of that type that adds the group's name to its Category (else Kind) options.
16. **Merging**: names and aliases that normalise the same (case, spacing, surrounding punctuation) merge by themselves, within a type; the agent's merges are applied and marked "Merged by the agent", which offers Split; near-duplicate names (the proposal's comparison form) are only suggested.
17. **The entity rule is enforced**: an entity that fails it, or is a category (a label option of a type in the space, or a tag), is listed under "Not made into objects" and can't be accepted; Gene can still merge it into an entity. A Software named exactly like a tag (Docker) stays a tag; "Docker 24" is Software. Source's own Category and System options count as categories too (an entity named "Wiki" stays text).
18. **Every entity must be decided before Write**, as every proposal item must be before Apply; **Accept the rest** makes that one click. With no entities, the pass still stops at the Entities step and Write finishes the batch.
19. **Entity types don't need a proposal item**: any importable type of the space but Source can hold entities; the entity list's review is the approval. A type without `sources` gets M28's definition at Write.
20. **Created entities carry an `importSource` block** (`id: entity:<typeId>:<key>`) and a `created` entry in `items.json`, so Move batch to Trash takes them and a re-run finds them instead of making twins. Objects that existed before keep their new Sources links and section when the batch is trashed (their Sources are in the Trash, restorable).
21. **Relations by name**: the relation is a relation property's name on the subject's type, or an M28 counterpart name, which stores the link on the other side. A quote must name both sides, except the page's main subject.
22. **Write runs in the filing worker** (states `entities`, then `writing`), records each step as it goes, and can be run again after a failure without placing anything twice.
23. **The entity list is computed on read** from the filing results and Gene's review, never stored, so reading it writes nothing.
24. **MCP**: one new read tool, `import_entities`, and `start_import` gains `keepAsSources`; accepting and writing stay app-only, like Apply; no tool writes a Source.

**Consumed from M28/M29 (names as their plans give them):** `Space.apply_setup("itops")`; `basicsetup.source_type()`, `basicsetup.sources_property()` and the `source` id in `ITOPS_TYPE_IDS` (M28, the Source type and the nine entity types' `sources` → counterpart `{"name": "Distilled into", "key": "distilledInto"}`); relation counterparts at `options["counterpart"] = {"name", "key"} | None`, found with `counterparts.find_relation`; `Space.counterparts(path) -> list[CounterpartRow]`; M28's IT ops property keys `runsOn`, `uses`, `fqdn`, `ipAddress`, `operatingSystem`, `locatedAt`, `covers`, `sources`; M29 `PropertyDefinition.synced: SyncedSpec | None` and `Space.ensure_id` (already in `space.py`).
