# Object IT ops type model and entity extraction: design

Date: 2026-11-09. Owner: Gene Hively. Status: **approved by Gene, 2026-11-09** (the whole document, our calls included). Plans: none yet (milestones after M27; see "Phases").

Builds on the base object model (types, properties, relations, collections, templates, "Pick a starting point"), the work model (M22: ticket fields on Task and Project), the agents milestones (M17-M21) and import and migration (M25-M27, `specs/2026-11-06-import-migration-design.md`), which this design extends.

## Why

Gene (2026-11-09): the types Object and his imported wiki ended up with "seem a little wonky". The wiki import made 27 types. Fifteen of them (ADR, Runbook, Reference, Report, Spec, Concept and others) carry the same nine properties, Server and Workstation are identical, and Ticket is a type although the work design made it a set of fields. The starter set (Person, Meeting, Project, Book) doesn't fit his work.

His direction:

> Servers/Workstations are Hosts, and Server/Workstation are categories. I don't want a direct import. I want to intelligently identify all things that are objects ... hosts, software, applications, configurations, broken down into bite-sized little objects linked together intelligently where it makes sense.

This applies to the wiki and to any other source. Every decision below was made by Gene on 2026-11-09 in a multiple-choice walkthrough, after he shared his older workspace export as a **structure reference only**. The export's type and property names, tag names and option values were read; nothing from inside its pages was. What it showed: typed links worked well (Server → operating system and primary function as links; Project → Servers and Software). Collections worked well as category views. Script, Command and SOP types were in real use. Roles typed into tag text, mostly-empty properties and 185 catch-all pages worked badly. A type holding keys and credentials was the one pattern never to repeat.

## Goals

1. **An IT ops starter set** of types that each earn their place with their own properties and relations, offered when a space is set up.
2. **Categories are properties or tags, not types.** A Host has a Category; VM is a tag.
3. **Named, two-way relations** between those types, so the graph can answer "what runs on APP01?" and "what breaks if it goes down?".
4. **Synced facts**: fast-changing values filled by scripts or agents stay fresh, can't be hand-edited, and never churn the Markdown files.
5. **Creating an object picks the right type**: the create row suggests one, and the type's template fills its fields.
6. **Imports extract entities**: the things a page talks about become their own linked objects, duplicates are merged into one, and Gene approves the entity list and merges.

## Non-goals

- Replacing the base starter. "Start with basic setup" (Person, Meeting, Project, Book) and "Empty space" stay. IT operations is an added choice.
- A CMDB or a monitoring tool. Synced facts are a snapshot for reading and filtering; live alerting stays in the tools that own it.
- Secrets in spaces. No type holds credentials or keys, and the import's sensitive scan keeps them out.
- Changing existing spaces' types automatically. An existing space can add the starter's types from the type gallery. Remodelling a space (such as the wiki import) is a run of the entity extraction workflow, which Gene approves.

## Anti-goals

- **Look-alike types**: two types with the same properties and no different behaviour.
- **A type per category**: Server, Workstation and VM as separate types.
- **Every noun an object**: entities follow the rule in section 6, not every capitalised word.
- **Duplicate entities**: "SQL 2019", "SQL Server 2019" and "MSSQL 2019" are one object with aliases.
- **Hand-typed live state**: an editable "Last boot" that is wrong by the next day.
- **Breaking Object's ground rules**: never write on read, edits change only their own lines, deletes go to the Trash, atomic writes, CRLF/BOM kept, no real CPI data in the repo (fixtures are synthetic; the starter's vocabulary is generic names only).

## The model

### 1. The IT ops starter

"Pick a starting point" (and "Create new space") gains a third choice, **IT operations** ("Includes hosts, software, applications, runbooks and incidents."; our string), next to "Start with basic setup" and "Empty space". It writes these types:

**Entities**

| Type | Own properties (beyond title, description, tags, notes) |
|---|---|
| **Host** | Category (label: Server, Workstation, Network device, Printer, NAS, Firewall, VPN); Roles (multi label: DNS, DHCP, Active Directory, File server, Print server, RDS, Hypervisor, Firewall/VPN); IP address (text); FQDN (text); Department (label); Environment (label: Production, Test, Development); Operating system (relation to Software); Located at (relation to Location); Network (relation to Network); Owned by (relation to Person or Vendor); plus the synced facts of section 3 |
| **Software** | Product (text: the product family, e.g. "SQL Server"); Version (text); Vendor (relation to Vendor); End of support (date) |
| **Application** | Status (label: Live, Planned, Retired); Owned by (relation to Person); Department (label); Runs on (relation to Host, Container); Uses (relation to Software) |
| **Container** | Image (text); Runs on (relation to Host); Part of (relation to Application) |
| **Configuration** | Kind (label: GPO, Firewall rule, Scheduled task, App setting, Template); Applies to (relation to Host, Application) |
| **Location** | Kind (label: Site, Building, Room, Rack); Part of (relation to Location) |
| **Network** | Kind (label: Subnet, VLAN, Wifi, Domain); Range (text: CIDR); VLAN id (number); Located at (relation to Location) |
| **Person** | the basic setup's Person, plus Department (label) |
| **Vendor** | Website (url); Support contact (text); Contract ends (date) |

**Knowledge**

| Type | Own properties |
|---|---|
| **Script** | Language (label: PowerShell, Bash, Python, AWS CLI); Covers (relation to Host, Application, Software) |
| **Command** | Shell (label: PowerShell, Bash, cmd, macOS); Covers (relation) |
| **Runbook** | Kind (label: Runbook, SOP); Covers (relation); Last reviewed (date) |
| **Prompt** | Model (text); Purpose (text); Used on (relation) |
| **Source** | Category (label: Wiki page, Document, Spreadsheet, Presentation, PDF, Diagram, Email, Ticket, Chat, Web page, Image, Note); System (label); Distilled into (counterpart). Read-only; filled by imports (section 5a). |

**Work**

| Type | Notes |
|---|---|
| **Task**, **Project** | as built (M4, M22), with ticket fields. Project gains Affects (relation to Host, Application, Software). |
| **Incident** | Status (label: Open, Mitigated, Resolved); Severity (label: SEV1-SEV4); Impact (text); Cause (text); Affects (relation to Host, Application); Started / Resolved (date and time); plus the ticket fields, so a service-desk ticket can sit on it. |
| **Meeting** | the basic setup's Meeting, with Type options Operations and Helpdesk added. |

Daily notes stay as built.

**Seed vocabulary (names only):**
- Technology tags: Windows, Linux, PowerShell, ESXi, VMware, vSphere, Synology, NAS, Docker, Terraform, Ansible, AWS, Office365, SharePoint, Active Directory, Subnet, Wifi, Backup, Automation, Diagram, Encryption, Infrastructure, Documentation, Script, AI, LLM, MCP, API, GitHub, VM.
- Statuses: Back log, In progress, On hold, Complete; Not started, Done.
- Priorities: Low, Medium, High.
- Departments: IT, Finance, All.

These are generic names taken from Gene's older export with his permission. Names tied to a past employer, or personal ones, are left out (our call).

Icons, colours and the exact option lists are our choice, listed for Gene in the plan.

### 2. Named two-way relations

- A relation property may name its **counterpart** on the target type: Application "Runs on" ↔ Host "Runs". The starter's pairs:

| Stored on | Shown on the target as |
|---|---|
| Application / Container "Runs on" → Host | "Runs" |
| Application "Uses" → Software | "Used by" |
| Host "Operating system" → Software | "Installed on" |
| Configuration "Applies to" → Host, Application | "Configured by" |
| Script / Command / Runbook "Covers" → any | "Documented in" |
| Host / Network / Location "Located at" → Location | "Contains" |
| any "Owned by" → Person, Vendor | "Owns" |
| Container "Part of" → Application | "Containers" |
| Project / Incident "Affects" → Host, Application, Software | "Affected by" |

- **One side is stored** (the "Stored on" column, in that object's frontmatter as today). The counterpart is **computed from the index** and shown as a property row on the target, so a link is never written in two files and the two sides can't disagree (our call).
- The counterpart row is editable: adding or removing a link there writes the *stored* side, on the other object, as a normal property edit.
- Counterparts are filterable, sortable and groupable like any relation, and the graph labels its edges with the relation name.
- Software is linked **per version** ("SQL Server 2019"); the Product property groups versions in views.

### 3. Synced facts

- A property can be marked **synced** (type settings), with a source name (e.g. "Inventory script"). The starter's Host gets these synced properties: Last boot (date and time), Disk free (number, GB), Patch state (label), Reboot pending (checkbox), Last seen (date and time).
- **Read-only in the app**: shown with the source and a "Refreshed {time ago}" line. Edits are offered nowhere, and a hand-edit to the file is overwritten on the next refresh.
- **Written only through the API** (`/api/v1`, a `read-write` token, and a new `sync` scope for these fields) or MCP: a script or agent sends values per object, matched by title, alias, or a stable key such as FQDN.
- **Stored outside the Markdown file** (our call): in `.object/synced/<type>.json`, keyed by object id, with a refreshed time per object. They are indexed like properties, so views, filters and queries use them, but a refresh never touches the `.md` file. That keeps edits line-minimal and stops git-backed spaces committing on every refresh. Exports include them.
- **One exception** (Gene, 2026-11-09): an object that has no `id` yet gets its `id` line on its first sync (one line, once); every later refresh leaves the file alone.
- **Stale marking**: a value older than the property's "stale after" (default 7 days; our value) shows muted with "Stale".

### 4. Creating an object: type suggestion and templates

- The create row (in `[[` / `@`, the palette, "+ New object" without a type, and Turn into object) shows a **suggested type** first, with the others below:
  - **Context first**: creating from a relation property suggests its allowed type. Creating inside a collection or query suggests its type.
  - **Then each type's name patterns**: a type may list patterns (e.g. Host: names like `APP01`, `SRV-*`, an IP or FQDN). The starter sets patterns for Host, Network (CIDR) and Software (a name with a version number).
  - **Otherwise** the type used last in this space.
- Choosing a type applies that type's **default template** (templates exist today). The IT ops starter ships one per type: its properties shown, and sections such as Host's "Purpose", "Access" and "Known issues" (our strings).
- No AI is involved in suggesting (our call: fast, predictable, nothing sent anywhere). The Assistant can still be asked.

### 5. Entity extraction on import

This extends the import design's schema proposal (section 8) and AI filing pass (section 9).

- **The filing pass returns entities and relations as well as page decisions.** For each page:
  - the page's **main entity**, if it is about one (a server page is about that Host);
  - **entity candidates** it mentions: type, name, aliases, property values, each value with its quote;
  - **relations**: subject, relation name (from section 2's set), object, with the quote that supports it.
- **Entity resolution** (the app, after all batches): candidates are merged by normalised name and aliases within a type, and the agent's suggested merges are added ("SQL 2019" = "SQL Server 2019"). Each merged entity keeps every name as an alias and every source page in its provenance.
- **Gene's review** (a new "Entities" step in the import wizard, after the schema step): entities grouped by type, each with its count of mentioning pages, its aliases, the suggested merges and splits. Each can be accepted, renamed, merged, split or turned down. Links are written without a further review; links from low-confidence candidates go to the Import inbox.
- **Writing**: the app creates the accepted entities, sets the stored side of each relation, fills each entity's distilled section (section 5a), and links each entity to the Sources that mention it. **A Source's text is never edited, not even to link a mention** (Gene, 2026-11-09): the links live in the entity's "From sources" section and the Sources relation. No imported page is turned into an entity: every page stays a Source (Gene, 2026-11-09, replacing the earlier "a page's own text becomes its main entity's notes").
- **The entity rule** (in the skill and checked by the app): a candidate becomes an object when it exists on its own, or more than one page mentions it, or it has properties of its own. Otherwise it stays text or a tag. Categories (Server, VM, Production) become property values or tags, never entities.
- The trial pass (50 pages), confidence levels, quotes and the scan run as in the import design. Nothing is written before Gene's approval of the schema and the entity list.

### 5a. Sources and distillation (Gene, 2026-11-09)

The import keeps the source data and distils what is relevant into the right objects, as an LLM-maintained wiki keeps its raw sources and builds its pages from them.

- **Every imported page is a Source object**: a **Source** type (created by the first import that needs it, in any space) holds the page's text exactly as it was, its kept original file and its `importSource` provenance. Sources are **read-only in the app** ("Imported source"); only a re-run of the same source updates one, and the previous text stays in version history.
- **The Source type** (Gene, 2026-11-09) is part of the IT ops starter as well (section 1, under Knowledge), and an import creates it in any other space that lacks it. Its own properties:
  - **Category** (label; our options): Wiki page, Document, Spreadsheet, Presentation, PDF, Diagram, Email, Ticket, Chat, Web page, Image, Note. The import sets it from the file format and the source system.
  - **System** (label, from `importSource.system`): SharePoint, Wiki, Notion, Obsidian, Anytype, Files, Markdown.
  - **Distilled into** (the counterpart of the entities' "Sources" relation).

  The provenance fields (link, author, dates, batch) show on its Source line, as for any imported object.
- **An option on every import** (Gene, 2026-11-09): "Keep pages as Sources" in the import wizard. On: every page becomes a Source, and with the AI filing pass entities are distilled from them. Off: pages are filed into their mapped types, as imports do today. Default (ours): on when the import runs the AI filing pass, off for a plain mapped import.
- **Entities are distilled from all their sources.** A Host mentioned by 12 pages gets the relevant facts from all 12, not just from its own page. Each entity has:
  - its **properties**, each value carrying the Source (or Sources) and the quote it came from;
  - a **distilled section** at the top of its body ("From sources"; our string): a short summary written by the filing pass, every line citing its Sources as links. The import owns this section: a re-run rewrites it when a cited Source changed, and nothing else in the body;
  - **Gene's own notes** below it, which the import never touches.
- **Links both ways**: every entity links to the Sources it was distilled from ("Sources", counterpart "Distilled into" on the Source), so a Source shows what was built from it.
- **When sources disagree** (two IPs for APP01), the value from the most recently modified Source wins; the conflict is listed in the import report and on the entity, with both values and their Sources, for Gene to settle.

### 5b. Conventions are rules in an IT ops space (Gene, 2026-11-09)

When the target space has the IT ops types, the schema proposal and the entity review enforce the conventions; a proposal that breaks one can't be applied:

- **Existing types first**: a group of documents maps onto an existing type when one fits; a new type is proposed only when none does (and the import design's 10-document and own-properties rules hold).
- **No look-alike types**: a proposed type whose properties match an existing type's is refused, with "Use <type>, with a category" offered instead.
- **Categories are never types or entities**: a grouping like Server, Workstation, VM or Production becomes a property value or a tag.
- **The entity rule** and **named relations** (section 2) as above; a relation outside the named set is written as a plain link.

### 6. Existing spaces

- The type gallery gains the IT ops types, so an existing space can add them one at a time.
- Remodelling an existing space (for example the wiki import) is a **run of the extraction workflow against that space** as the source, written into a new space or a copy. The original space is never changed.

## Phases (milestones after M27; order is ours)

- **M28, the IT ops starter and two-way relations**: the starter choice and its types, templates and vocabulary; relation counterparts (stored side, computed side, editing from either side, graph edge labels); the gallery entries.
- **M29, synced facts and type suggestion**: synced properties and their store, the `sync` token scope and API/MCP write, stale marking; the create row's suggested type and name patterns.
- **M30, entity extraction**: the filing pass's entities and relations, entity resolution, the wizard's Entities step, writing and mention linking, main-entity notes.

## Decided by Gene (2026-11-09)

- The import extracts entities; it doesn't map pages to types. Categories are properties or tags; VM is a tag.
- Entity types: Host, Software, Application, Configuration, Location, Network, Person, Vendor, and Container. Knowledge types: Script, Command, Runbook/SOP, Prompt. Work types: Task, Project, Incident (its own type; ticket fields sit on it), Meeting.
- Software is one object per version, grouped by product.
- Host Roles are a multi-select.
- Network covers subnets, VLANs, wifi, and domains and the network side of sites. Firewalls and VPNs are Hosts with a category.
- Software is an installable product; Application is a system CPI runs, which uses Software and runs on Hosts.
- Fast-changing Host facts are synced, read-only fields with a refreshed time.
- Creating an object suggests the type, and the type's template fills it.
- Named two-way relations: runs on / runs, installed on / uses, applies to / covers, located at / owned by.
- (Superseded the same day, see 5a) ~~A page's own text becomes its main entity's notes.~~ Every imported page is kept as a read-only Source; entities are distilled from all their Sources with citations, a summary section the import owns and Gene's own notes kept apart; the newest Source wins a conflict, which is listed. In an IT ops space the conventions are hard rules (5b). Gene reviews the entity list and merges; links are written without asking.
- New spaces get an IT ops starter. Its vocabulary comes from his older export, names only.

## Our calls (for Gene to check while reading)

1. IT operations is a **third choice** beside basic setup and empty space, not a replacement.
2. The property lists and option values in section 1 beyond what Gene named, such as Environment, Severity SEV1-SEV4, Location kinds and Vendor's fields.
3. Relations are **stored on one side** and the counterpart is computed; the "Stored on" column picks the side.
4. Synced facts live in **`.object/synced/`**, not in the `.md` file; "stale after" defaults to **7 days**.
5. Type suggestion uses **context and name patterns, no AI**.
6. Seed tags tied to a past employer or personal life are left out.
7. Remodelling an existing space writes into a **new space or copy**; the original is never changed.

## Left to the builder

- Icons and colours per type; the template sections' exact text.
- The name-pattern syntax.
- The Entities step's layout, in the import wizard's style.
