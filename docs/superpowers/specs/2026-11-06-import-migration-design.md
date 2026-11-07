# Object import and migration: design

Date: 2026-11-06. Owner: Gene Hively. Status: **approved by Gene, 2026-11-06** (the whole document, our calls included). Built 2026-11-06/07 as M25-M27. Plans: `docs/superpowers/plans/2026-11-06-m25-provenance-and-reruns.md`, `2026-11-06-m26-readers-and-scan.md`, `2026-11-06-m27-agent-workflow.md` (acceptance: `m25-acceptance.md`, `m26-acceptance.md`, `m27-acceptance.md`, `m27-ui-acceptance.md`).

Builds on M1-M15 (types, properties, media blocks, File/Image/PDF types, the importer, version history, Trash, "Exclude from AI"), on the agents milestones M16-M21 (`specs/2026-11-05-agents-design.md`: skills, the MCP gateway, schedules) and on the MCP server (M11).

## Why

Gene will move large, messy collections into Object: his LLM wiki, SharePoint libraries, and later other sources. Their documents don't follow Object's types, properties or layouts, and many aren't Markdown at all (Word, Excel, PDF, Visio, PowerPoint, images). The import Object has today (Markdown, Obsidian, Notion, Anytype) maps structured sources well, but it was built for one-time moves of notes. It doesn't keep where each object came from, can't bring a source in twice without duplicating it, doesn't read Office files or PDFs, and leaves the schema work to the person importing.

The lesson from the wiki import (2026-10/11): a rule-based import "isn't intelligent". What worked was reading every page and filing it as the right type with real properties, tags and links. That reading has to be a supported, repeatable workflow, which an agent inside Object or an external agent over MCP can run the same way, with Gene approving the schema.

Gene's points (2026-11-06):

> Our software supports images and such ... isn't there a way to import those images and data without losing anything?

> With SharePoint it could be useful to include a reference link in the metadata to the original; the same could be said for any import, if that information is available.

## Goals

1. **Nothing is lost.** Every source document becomes a readable Object page, with its images placed where they appeared, **and** the untouched original file, linked from that page. Conversion can be imperfect; the original never is.
2. **Every imported object knows where it came from**: a link that opens the original, its id and version in the source, its author and dates, and the import batch. This holds for every source that can tell us, not only SharePoint.
3. **Imports can run again.** A later run of the same source updates the objects it made earlier, instead of duplicating them, and never overwrites Gene's own edits silently.
4. **A schema that Gene approves.** An agent surveys the source and proposes types, properties and options with evidence; Gene approves; only then is anything created. Types found late go back to the proposal.
5. **Sensitive content stays away from AI**: a local scan runs before any agent reads a document, and what it flags is left out or kept with "Exclude from AI".
6. **One workflow, any agent**: the same stages run from Object's own agents (as a skill) or from an external agent through the MCP server.
7. **Every step can be checked and undone**: a report that accounts for every source item, a batch that can be moved to the Trash in one action, and a scratch-copy first rule.

## Non-goals

- Two-way sync with any source. An import reads; Object never writes back to SharePoint, Notion or the wiki.
- Carrying source permissions. An Object space has no per-object access; choosing what goes into a space is Gene's decision (stated in the workflow, not enforced by code).
- A built-in Microsoft 365 account or OAuth flow in Object (accounts stay out for good). SharePoint is reached by an agent through an MCP server Gene adds (M19), or through files already on disk.
- Converting the original Office files losslessly into editable Object blocks. The readable page is best-effort; the original is the record.
- Moving the wiki itself. That project consumes this one.

## Anti-goals

- **Silent loss.** A value, file, link or page that doesn't make it in is listed in the report with a reason; the counts always reconcile.
- **Silent overwrite.** A re-run never replaces an object Gene edited after its import without asking; the old content stays in version history either way.
- **Duplicates on re-run.**
- **Invented values.** An agent never sets a date, owner, id or option it can't quote from the source.
- **An agent approving its own schema.** Creating types from a proposal is Gene's action in the app.
- **AI reading what the scan flagged**, or what is marked "Exclude from AI".
- **Breaking Object's ground rules**: never write on read, property edits change only their own lines, deletes to the Trash, atomic writes, CRLF/BOM kept, no real CPI data in the repo (fixtures are synthetic).

## The model

### 1. Provenance: where an object came from

Every imported object carries one frontmatter block, the same for every source:

```yaml
importSource:
  system: sharepoint        # sharepoint | notion | wiki | obsidian | anytype | files | markdown
  url: https://...          # opens the original; absent when the source has none
  id: "01ABC..."            # the source's own id (SharePoint item id, Notion page id, repo path, file path)
  version: "7.0"            # SharePoint version, git commit, file hash; whatever the source has
  author: "..."             # as the source writes it
  created: 2024-03-02T10:11:00Z
  modified: 2026-10-30T08:00:00Z
  original: Attachments/Originals/Runbook - DNS.docx   # the kept original (section 2), when there is one
  contentHash: "sha256:..." # of the original bytes, for re-runs (section 5)
  batch: 01JC...            # the import batch (section 7)
  importedAt: 2026-11-06T16:00:00Z
```

- It is a **system field, not a type property** (our call): no type gets cluttered with import details, and every type, existing or new, can carry it.
- **Shown** on the object page as a "Source" line under the properties, with **Open original** (the url, else the kept file) and **Show file** (the kept original). Hidden when absent.
- **Queryable**: queries and filters get "Imported from" (system), "Import batch" and "Source modified".
- **What each source gives:**

| Source | url | id | version | author / dates |
|---|---|---|---|---|
| SharePoint (via manifest, section 4) | item web URL | item id | version label | created by, created, modified |
| Notion | `https://www.notion.so/<id>` rebuilt from the export's page id | page id | none | export metadata when present |
| Wiki (git) | repo web URL at the commit, when the repo has a remote; else none | repo path | commit sha | last commit author and date |
| Obsidian, folders | `file:` path of the source copy | relative path | content hash | file dates |
| Anytype | none | object id | none | export metadata |

- Provenance is written once by the import and changed only by a re-run. Editing the object doesn't touch it. A merge keeps the target's block and lists the source's in the merge note.

### 2. Keep the original

- For every source file that isn't plain Markdown, the import keeps the **original bytes** in `Attachments/Originals/` (names made safe and unique as attachments are today) and records it in `importSource.original`.
- **Option per import, "Keep originals as"**: *Attachments* (default: the file sits with the page, opened from the Source line) or *File objects* (each original becomes a File/PDF/Image object of its own, linked from the page through a "Original" relation). Our call: attachments by default, because File objects double the object count.
- Originals over the attachment limit (100 MB) are not copied. The report lists them, and the Source line keeps the url.
- Markdown sources keep no copy: the page is the original. Their images and linked files come across as attachments, as they do today.

### 3. Readers: from files to pages

A new source kind, **Files** (a folder of mixed files, such as an export or a synced library), plus readers per format. Each reader produces the readable page; the original is kept regardless.

| Format | Readable page | Notes |
|---|---|---|
| .docx | headings, paragraphs, lists, tables, links; embedded images extracted to Attachments and placed as media blocks where they were | merged-cell tables flatten; the report says so per document |
| .pdf | the extracted text as the page body, with the PDF itself shown as a media block at the top | scanned PDFs (no text layer) are marked "Needs OCR" and get OCR when a local OCR engine is installed; otherwise they keep the PDF only |
| .xlsx / .csv | each sheet up to 200 rows x 20 columns as a table; larger sheets link to the original | formulas come across as their values |
| .pptx | one section per slide: its title, text and images | speaker notes as a toggle under each slide |
| .vsdx, other binaries | the original as a media/file block; no extracted text | listed as "Original only" |
| images, audio, video | an Image (or File) object with the file | EXIF date fills `importSource.created` when there is no other |
| .md, .txt, .html | as today's Markdown import; HTML converted to Markdown | |

Every reader is local (Python libraries in the app's environment, no cloud). The builder picks the libraries (left to the builder); each must be pure Python or ship as a wheel for Windows.

### 4. The manifest: metadata that sits beside the files

Some metadata can't be read from a file (a SharePoint item's URL, version, author, its library columns). Any source folder may hold a **manifest**, `_manifest.jsonl`, with one line per file:

```json
{"path": "Runbooks/DNS.docx", "system": "sharepoint", "url": "https://...", "id": "...", "version": "7.0",
 "author": "...", "created": "...", "modified": "...", "fields": {"Owner": "...", "Environment": "Prod"}}
```

- The Files reader fills `importSource` from it, and treats `fields` like frontmatter: each field becomes a planned property the mapping step can name, type or skip.
- **SharePoint, in practice:** an agent with a Microsoft 365 MCP server (added through M19) lists the library, downloads the files into a staging folder and writes the manifest. Every download is a step Gene approves (it brings files onto the machine). A library synced to disk by OneDrive also works as a Files source; without a manifest it gets file paths and dates only.
- The manifest format is open, so any future source (Confluence, a file share) needs only a fetch step that writes files plus a manifest.

### 5. Running an import again

- A re-run matches source items to existing objects by `(system, id)` in the target space.
- **Unchanged** (same `contentHash` or version): skipped, listed as unchanged.
- **Changed at the source, untouched in Object** (the object's file hasn't changed since `importedAt`): updated in place; the previous content is kept in version history.
- **Changed at the source and edited in Object**: not overwritten. Listed under "Changed in both" in the report, with **Take source** (the Object edit stays in version history) and **Keep mine** per item, or for all.
- **New at the source**: imported. **Gone from the source**: listed as "Removed at source"; never moved to the Trash automatically.
- Re-runs reuse the last approved mapping and schema for that source (stored with the import's records, section 7), so a weekly wiki refresh needs no new questions unless new kinds of documents appear.

### 6. Sensitive content: a scan before any AI

- Before the survey and before any agent reads a document, a **local scan** (no AI, nothing leaves the machine) checks every file's text for: private keys, API keys and tokens by their known formats, password assignments, connection strings, and card numbers (13-19 digits passing the Luhn check).
- Folders and patterns Gene names in the import ("Leave out") are never read at all, as the wiki import left out its credentials folder.
- Each flagged file gets the choice: **Leave out**, or **Import, excluded from AI** (default for flagged files: the object is written with `excludeFromAI: true`, so the local API and agents never see it). Gene can review the list before anything is imported.
- The scan's findings name the file, the kind of match and the line, never the matched value. The report holds the same.

### 7. Batches, records and undo

- Every import run is a **batch** with an id. Its records live in `.object/imports/<batch>/`: the source, the mapping, the approved schema proposal, the scan results, the report, and the AI pass's decisions (section 9).
- **Move batch to Trash**: one action that moves every object the batch created (not ones it only updated) to the Trash, restorable as any Trash item. Updated objects are restored from version history per item.
- **Scratch first**: the import wizard offers "Try on a copy of this space" (the default for the first run of a new source), which imports into a copy of the space under a new name, for Gene to look at before the real run.

### 8. The schema proposal

- An agent (or Gene) **surveys** the source: it reads documents (sampled or all; scan-flagged ones excluded) and groups them by what each one is, not by folder. It reads the target space's types first (MCP `schema`, `type_definition`).
- It writes a **proposal** into the batch records: for each group, one of
  - **use** an existing type (with a property mapping),
  - **extend** an existing type (new properties), or
  - **create** a type (name, plural, icon, colour, properties with kinds and options),

  each with its evidence: document count, 2-3 example documents, how often each property has a value, the distinct values behind each option.
- **Rules the proposal follows** (written into the skill and checked by the app): a new type needs at least 10 documents and properties of its own, otherwise the group becomes a tag or a collection on an existing type; a property needs a value in at least 30% of its group; options come from values found, merged when they differ only by case, spacing or common abbreviations, with the merge shown; relation properties between proposed types are included.
- Gene **reviews it in the import wizard** ("Proposed schema" step): each item can be accepted, edited or turned down. **Apply** creates and edits the types, and is available only in the app, never as an MCP tool (an agent can't approve its own schema).
- Objects that fit no approved type later (during the AI pass or a re-run) go to the **Import inbox** collection with a proposal item, never to a type invented on the spot.

### 9. The AI filing pass

- Runs after the schema is applied and the bulk import has written the pages. One agent run per batch of objects (our value: 40 per run, as the wiki import used), read-only on the space: it reads each page and returns **decisions** (type, property values, tags, collections, links to other objects), each with a confidence (high / medium / low) and, for every value, the quote from the page it came from.
- **The app applies the decisions**, not the agent: it checks each value against its quote and the property's kind, writes only what passes, and lists the rest. Low-confidence objects go to the Import inbox for Gene.
- **Trial first**: the first run of a new source applies the pass to 50 objects and shows the results for Gene to mark right or wrong; the bulk pass starts only after he continues. The share marked right is recorded in the report.
- **Normalise after**: once all batches are done, one pass lists near-duplicate tags and option values across the batch ("Prod", "Production", "PRD") for Gene to merge.
- **Links last**: relation properties and links between objects are filled in a final pass once every object exists, so a page can link to one imported after it.
- Agents in this pass get read tools on the space and the batch, nothing else. Document text is untrusted input: the decisions format is the only thing the app takes from the run.

### 10. The report

Each batch ends with a report (an Object page in the space, also kept in the batch records):

- **Counts that reconcile**: source items = imported + updated + unchanged + left out + failed, with a reason for every item not imported.
- Per item: originals kept or too large, conversion losses (flattened tables, "Needs OCR", "Original only"), values that didn't fit their property, unresolved links, scan findings, AI confidence.
- "Changed in both" and "Removed at source" lists with their actions (re-runs).
- The trial pass's accuracy.

### 11. The migration skill

A skill, **Migrate a source**, ships with Object's agents (M18 skills) and is published for external agents with the MCP server. It walks the stages in order and stops at each of Gene's gates:

1. Stage: a copy of the source (or a fetched folder plus manifest); never the original.
2. Scan (section 6). Gate: Gene reviews flagged files and the left-out list.
3. Survey and proposal (section 8). Gate: Gene approves the schema in the app.
4. Bulk import into a scratch copy, then the real space (sections 3-5, 7).
5. Trial AI pass (section 9). Gate: Gene marks the trial.
6. Bulk AI pass, normalise, links.
7. Report and Import inbox (section 10). Gate: Gene files the inbox.
8. Cutover note: where new documents get written from now on, and a reminder to make the source read-only.

The skill also carries the checklists that aren't code: which libraries belong in this space (permissions don't carry over), people's names mapped once to Person objects, templates added to new types, a full-size test of search and startup before cutover, and resumable batches (a stopped run picks up from its batch records).

### 12. MCP tools

New tools (write tools follow M11's rules: revision-checked, off when the MCP server runs read-only):

| Tool | Does |
|---|---|
| `import_scan(path, leave_out)` | runs the sensitive scan, returns the findings (no values) |
| `import_preview(path, kind)` | exists; gains the Files kind and the manifest |
| `save_import_proposal(batch, proposal)` | stores a schema proposal for Gene's review |
| `import_proposal(batch)` | reads it back with Gene's decisions |
| `start_import(preview_id, target, mapping)` | exists; refuses a mapping that creates types not in an approved proposal |
| `save_import_decisions(batch, decisions)` | hands the AI pass's decisions to the app, which applies them (section 9) |
| `import_report(batch)` | reads the report |

There is no tool to approve a proposal or to apply decisions without the app's checks.

## Phases (M25-M27, built; order is ours)

- **M25, provenance and re-runs**: the `importSource` block and its Source line, filters, keep-originals, batches and Move batch to Trash, the Files source kind with the manifest, re-runs (section 5), the report's counts.
- **M26, readers and the scan**: docx, pdf (with optional OCR), xlsx/csv, pptx, images and media; the sensitive scan and "Leave out".
- **M27, the agent workflow**: the proposal (records, wizard step, Apply), the AI filing pass with trial and normalise, the new MCP tools, the Migrate a source skill, SharePoint fetching through an MCP server.

## Our calls (for Gene to check while reading)

1. Provenance is **one system frontmatter block** (`importSource`), not per-type properties.
2. Originals are kept as **attachments by default**, File objects as an option; originals live in `Attachments/Originals/`.
3. The new source kind is named **Files**; the manifest is `_manifest.jsonl`.
4. Table limit for sheets: **200 rows x 20 columns**; AI batch size **40**; trial size **50**; new type needs **10** documents; property needs **30%** of its group.
5. A re-run treats an object as "edited in Object" when its file changed after `importedAt`.
6. Flagged files default to **Import, excluded from AI**, not Leave out.
7. "Removed at source" is never trashed automatically.
8. The report is an Object page in the space.
9. Applying a proposal is app-only; there is no MCP tool for it.

## Left to the builder

- The conversion libraries per format, and the local OCR engine to detect.
- The exact secret and token patterns of the scan (the kinds above are the floor).
- The wizard's layout for the scan, proposal and trial steps, in Object's existing import wizard style.
