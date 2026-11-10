# Milestone 28: the IT ops starter and two-way relations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** "Pick a starting point" and "Create new space" gain a third choice, **IT operations**, that writes the IT ops types (Host, Software, Application, Container, Configuration, Location, Network, Person, Vendor, Script, Command, Runbook, Prompt, Source, Project, Incident, Meeting), one default template per type (Source has none: its body is the imported text) and the seed vocabulary. The nine entity types carry a **Sources** relation to Source, whose computed other side is **Distilled into** (design section 5a; M30 fills both). A relation property may name a **counterpart**: the other side is computed from the link index and shown as an editable property row on the target, filterable, sortable and groupable like any relation, and the graph labels edges with the relation name. The type gallery gains the IT ops types.

**Architecture.** The starter lives in `basicsetup.py` next to the basic setup (`itops_types()`, `write_itops_types(root)`), built from the same `_prop`/`_label`/`_relation` helpers. A counterpart is one option on the stored side's `entity` definition (`options.counterpart = {name, key}`); nothing is ever written on the target. A new pure module `counterparts.py` turns the space's types into counterpart specs and virtual property definitions; `LinkIndex.counterparts(path)` answers the rows from the existing incoming-link map and `link_keys`; `rows.py` puts counterpart values into every row, so the client's view engine (filter, sort, group, calculate), saved queries and `/api/v1` reads get them with no other change. Editing a counterpart row is `Space.edit_counterpart`, which runs one ordinary `update_properties` per other object on its stored side. The graph gets one label per link pair from the same specs.

**Tech Stack.** Python 3 (FastAPI, pydantic, ruamel.yaml via `frontmatter.py`), `uv`; React, TypeScript, zustand, shadcn/ui, Tailwind, sigma (the graph), vitest. No new dependencies.

**Spec.** `docs/superpowers/specs/2026-11-09-it-ops-type-model-design.md`, sections **1** (the IT ops starter, including the Source type under Knowledge), **2** (named two-way relations), **5a** (only the Source type's definition and the Sources / Distilled into pair; everything else in 5a is M30's) and **6** (existing spaces: the gallery), plus the Phases line for M28 ("the starter choice and its types, templates and vocabulary; relation counterparts (stored side, computed side, editing from either side, graph edge labels); the gallery entries"). Sections 3-4 are M29's, section 5 is M30's; this plan only provides what they consume (Contract, "Consumed by M29/M30"). Remodelling an existing space (section 6, second bullet) is M30's extraction run.

Built on `master` (M1-M27). Everything here is new schema ("Beyond the catalog"); names, options and relation labels the design gives are verbatim, everything else is "our string" or "our choice" and listed in "Our calls".

## Global Constraints

- Never write on read: opening a space, `GET /api/space`, `GET /api/object`, `POST /api/rows`, `GET /api/graph`, `GET /api/type-gallery`, `/api/v1/object` and every counterpart computation write no file (`.md`, type JSON, state).
- A counterpart is never stored: the target object's file is never written by a counterpart read or edit. Editing a counterpart row changes only the stored property's lines (and `lastUpdated`) of each other object, through `Space.update_properties`.
- CRLF and BOM are kept; every write is atomic; a write that changes nothing writes nothing.
- Setup writes only when the user picks it, and never replaces a file: a type id, template file or Tag that exists already is kept as it is.
- The setup choice values are exactly `"blank"`, `"basic"`, `"itops"`.
- IT operations label "IT operations"; description "Includes hosts, software, applications, runbooks and incidents." (the design's string, verbatim).
- "Start with basic setup" and "Empty space" stay as they are; IT operations is a third choice, not a replacement.
- Type names, property names, label options and the counterpart names are the design's, verbatim (Contract tables).
- Seed vocabulary is the design's generic names only (Contract, "Seed vocabulary"); no other name from any export.
- No type holds credentials or keys.
- Fixtures are synthetic (`APP-TEST-01`, `Sam Example`, `Example Vendor`); no real host, person or employer.
- The server binds 127.0.0.1 only; `/api` needs the per-launch key (tests built with `create_app` and no `ui_key` skip it).
- Every feature unlocked; no badge, upsell or limit.
- Tests use `OBJECT_STATE_DIR` in a temp folder; no agent runs in this milestone; nothing touches `~/.claude`.
- Never name the notes app this project was modelled on, nor the open-source agent whose patterns the agents design adopts, in code, strings, fixtures or docs.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five failure modes no task's ordinary tests would catch, most likely first. Each has its test in the owning task.

1. **A counterpart edit writes the wrong file or too much.** Adding "Inventory app" to Host APP-TEST-01's "Runs" row must change only `runsOn` and `lastUpdated` in `Applications/Inventory app.md`, never `Hosts/APP-TEST-01.md`; CRLF+BOM of the other file kept; removing the last link writes `runsOn` away as `update_properties` does today; a single-valued source (Operating system) is replaced, not appended. Test: `backend/tests/test_m28_space.py::test_counterpart_edit_touches_only_the_stored_side` (T5, on the CRLF+BOM fixture, comparing bytes outside the expected hunk) and `::test_single_source_is_replaced` (T5).
2. **Reads write.** Opening the IT ops fixture, reading every object with counterparts, rows, the graph, the gallery. Test: `backend/tests/test_m28_api.py::test_reads_write_nothing` (T5: the space's file snapshot and the state dir listing are unchanged after every read route).
3. **Hand-edited type files and key collisions.** A `counterpart` that is a string, has no key, a key with spaces, or a key equal to a stored key on the target type; a hand-written `runs:` line in a Host's front matter. Expected: a badly shaped counterpart is dropped on read (no crash, no row); a key taken on the target leaves the stored property winning and no counterpart row on that type; saving such a type answers 422 with the Contract text. Test: `backend/tests/test_m28_counterparts.py::test_bad_counterparts_are_dropped_and_stored_keys_win` (T4) and `test_m28_space.py::test_save_type_checks_counterparts` (T5).
4. **Links that shouldn't count.** An unresolved target (`[[Missing host]]`), a self link, a template linking to a Host, a body link `[[APP-TEST-01]]` from a Page, a link via an alias or the path form, an object of a type the source doesn't allow (a Page with a `runsOn` key), a rename of the target. Expected: only resolved `entity` values of a property with a counterpart, from non-template objects, count; alias and path form count; a rename keeps the row (the index re-resolves). Test: `test_m28_counterparts.py::test_only_resolved_relation_values_count` and `::test_rename_keeps_rows` (T4).
5. **Setup on a space that isn't fresh.** `apply_setup("itops")` on a space with a hand-made `host.json`, an existing `Templates/Hosts/Host.md`, an existing `Tags/Windows.md`, or after "basic" was picked. Expected: existing files kept byte for byte, the rest written, no duplicate Tag, the second pick answers 409, `needs_setup` false after. Test: `backend/tests/test_m28_setup.py::test_itops_setup_keeps_what_exists` (T3).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| IT ops types | `.object/types/<id>.json`, ids `ITOPS_TYPE_IDS` | `write_itops_types` (new space), `Space.apply_setup("itops")`, the gallery (`Space.create_type`, one at a time) |
| Default templates | `Templates/<folder>/<Type name>.md` with `template: <Type name>`, registered as the type's `templates.ids[0]` and `defaultTemplateId` | the same |
| Seed tags | `Tags/<name>.md`, Tag objects (as `Space.ensure_tag` writes them) | setup only |
| The setup pick | `.object/space.json` key `setup` = `"itops"` | as today |
| Counterpart | the stored side's property definition: `options.counterpart = {"name": str, "key": str}` | type save, the starter, the gallery |
| Counterpart values | **nowhere**: computed from the link index on read | nobody |

### The starter types (`basicsetup.itops_types()`)

`ITOPS_TYPE_IDS = ("host", "software", "application", "container", "configuration", "location", "network", "person", "vendor", "script", "command", "runbook", "prompt", "source", "project", "incident", "meeting")` (17). Each type: `system_property_defs()`, then the properties below in order, then `notes` (Notes, `blocks`). Name / plural / folder (= plural) / icon / colour / description are our choice except the names. Relation targets are type ids (as `basic_types` does). Kinds: `label` single unless "multi"; relation = `entity` multi unless "single"; date = `datetime` with `resolutionPreference: "day"`; date and time = `datetime` with `resolutionPreference: "time"`.

| id | Name / plural | Icon, colour | Own properties: key Name (kind: options) |
|---|---|---|---|
| host | Host / Hosts | `ph-hard-drives`, blue | `category` Category (Server, Workstation, Network device, Printer, NAS, Firewall, VPN); `roles` Roles (multi: DNS, DHCP, Active Directory, File server, Print server, RDS, Hypervisor, Firewall/VPN); `ipAddress` IP address (text); `fqdn` FQDN (text); `department` Department (IT, Finance, All); `environment` Environment (Production, Test, Development); `operatingSystem` Operating system (single → software, counterpart Installed on); `locatedAt` Located at (single → location, counterpart Contains); `network` Network (→ network); `ownedBy` Owned by (→ person, vendor, counterpart Owns) |
| software | Software / Software | `ph-package`, violet | `product` Product (text, description "The product family, e.g. SQL Server"); `version` Version (text); `vendor` Vendor (single → vendor); `endOfSupport` End of support (date) |
| application | Application / Applications | `ph-app-window`, indigo | `status` Status (Live, Planned, Retired); `ownedBy` Owned by (→ person, counterpart Owns); `department` Department; `runsOn` Runs on (→ host, container, counterpart Runs); `uses` Uses (→ software, counterpart Used by) |
| container | Container / Containers | `ph-shipping-container`, cyan | `image` Image (text); `runsOn` Runs on (→ host, counterpart Runs); `partOf` Part of (single → application, counterpart Containers) |
| configuration | Configuration / Configurations | `ph-sliders-horizontal`, amber | `kind` Kind (GPO, Firewall rule, Scheduled task, App setting, Template); `appliesTo` Applies to (→ host, application, counterpart Configured by) |
| location | Location / Locations | `ph-map-pin`, emerald | `kind` Kind (Site, Building, Room, Rack); `partOf` Part of (single → location, counterpart Contains) |
| network | Network / Networks | `ph-network`, sky | `kind` Kind (Subnet, VLAN, Wifi, Domain); `range` Range (text, description "CIDR"); `vlanId` VLAN id (number); `locatedAt` Located at (single → location, counterpart Contains) |
| person | Person / People | basic | the basic Person's properties, then `department` Department, before Notes |
| vendor | Vendor / Vendors | `ph-storefront`, orange | `website` Website (url); `supportContact` Support contact (text); `contractEnds` Contract ends (date) |
| script | Script / Scripts | `ph-file-code`, teal | `language` Language (PowerShell, Bash, Python, AWS CLI); `covers` Covers (→ host, application, software, counterpart Documented in) |
| command | Command / Commands | `ph-terminal-window`, gray | `shell` Shell (PowerShell, Bash, cmd, macOS); `covers` Covers (→ any, counterpart Documented in) |
| runbook | Runbook / Runbooks | `ph-book-open-text`, lime | `kind` Kind (Runbook, SOP); `covers` Covers (→ any, counterpart Documented in); `lastReviewed` Last reviewed (date) |
| prompt | Prompt / Prompts | `ph-chat-text`, fuchsia | `model` Model (text); `purpose` Purpose (text); `usedOn` Used on (→ any, no counterpart) |
| source | Source / Sources | `ph-file-text`, gray (fix pass: "slate" is no theme colour) | `category` Category (Wiki page, Document, Spreadsheet, Presentation, PDF, Diagram, Email, Ticket, Chat, Web page, Image, Note); `system` System (SharePoint, Wiki, Notion, Obsidian, Anytype, Files, Markdown). No stored relation: its "Distilled into" row is the computed other side of the entities' `sources`. Built by `source_type()`; no template. Making Source objects read-only, and writing them, is M30's |
| project | Project / Projects | basic | the basic Project exactly (M22 work fields included), with `status` options Back log, In progress, On hold, Complete (statusCategory not-started, in-progress, blocked, done; **guess G2**), `priority` Priority (Low, Medium, High; **guess G2**) after Type, and `affects` Affects (→ host, application, software, counterpart Affected by) after Meetings |
| incident | Incident / Incidents | `ph-warning-octagon`, red | `status` Status (Open, Mitigated, Resolved; statusCategory in-progress, in-progress, done); `severity` Severity (SEV1, SEV2, SEV3, SEV4); `impact` Impact (text); `cause` Cause (text); `affects` Affects (→ host, application, counterpart Affected by); `started` Started (date and time); `resolved` Resolved (date and time); then Notes; then `workfields.field_defs(task=False, project_type_ids=["project"])` with `deskResolved` named **Desk resolved** on this type (**guess G3**), then Task's hidden `completed` |
| meeting | Meeting / Meetings | basic | the basic Meeting, `meetingType` options with Operations and Helpdesk appended |

**The Sources relation** (`sources_property()`): on each of the nine entity types (host, software, application, container, configuration, location, network, person, vendor), after their own properties and before Notes: `sources` Sources (→ source, counterpart Distilled into), visibility `hideWhenEmpty` (the one exception to `alwaysShow`: a hand-made object has no Sources). M30 adds the same definition to any other type it distils an entity into.

Option colours (our choice): Environment Production red, Test amber, Development green; Application Status Live green, Planned yellow, Retired gray; Incident Status Open red, Mitigated amber, Resolved green; Severity SEV1 red, SEV2 orange, SEV3 amber, SEV4 gray; Department IT blue, Finance green, All gray; every other list takes `blue, green, amber, violet, sky, rose, teal, orange, indigo` in order (cycling). Option ids are `label_options`' slugs. Visibility: every own property `alwaysShow` (the design's "its properties shown").

`cause` on Incident is a `text` property; M22's work field `cause` (a label) has the same key, so on Incident the work field set is added **without** `cause` (our call, key clash; the Incident's own Cause wins).

### Counterparts (stored side, design section 2)

| Stored on (key) | → target types | `counterpart` `{name, key}` |
|---|---|---|
| application.`runsOn`, container.`runsOn` | host (+ container for Application) | `{"name": "Runs", "key": "runs"}` |
| application.`uses` | software | `{"name": "Used by", "key": "usedBy"}` |
| host.`operatingSystem` | software | `{"name": "Installed on", "key": "installedOn"}` |
| configuration.`appliesTo` | host, application | `{"name": "Configured by", "key": "configuredBy"}` |
| script.`covers`, command.`covers`, runbook.`covers` | host, application, software (Script); any (Command, Runbook) | `{"name": "Documented in", "key": "documentedIn"}` |
| host.`locatedAt`, network.`locatedAt`, location.`partOf` | location | `{"name": "Contains", "key": "contains"}` |
| host.`ownedBy`, application.`ownedBy` | person, vendor (Host); person (Application) | `{"name": "Owns", "key": "owns"}` |
| container.`partOf` | application | `{"name": "Containers", "key": "containers"}` |
| `sources` on host, software, application, container, configuration, location, network, person, vendor | source | `{"name": "Distilled into", "key": "distilledInto"}` |
| project.`affects`, incident.`affects` | host, application, software (Project); host, application (Incident) | `{"name": "Affected by", "key": "affectedBy"}` |

Rules (`counterparts.py`):

- A counterpart applies to target type T for source property P of type S when P is `entity` and `counterpart` is valid, and P's `allowedTypes` contains T, or is empty ("any"). Explicit targets get the row always (`visibility: "hideWhenEmpty"` on the virtual def); "any" targets get it only while it has a value.
- A **valid** counterpart: a dict, `name` a one-line string of 1-60 characters, `key` matching `^[A-Za-z][A-Za-z0-9]{0,59}$`, not a system key (`SYSTEM_KEYS`, `backlinks`, `title`, `type`, `tags`, `aliases`, `id`). Read: an invalid one is dropped by `normalize_options` (no row, no crash). Save (`check_type`): 422 with the texts below.
- A counterpart key that is a stored property key on T: T gets no row for it (the stored property wins); saving S with it, when T is an explicit target, is refused.
- Rows with the same `key` from several sources (Script/Command/Runbook "Documented in") are separate `CounterpartRow`s; the UI and the virtual definition merge them by key.
- A path counts when it is a non-template object of type S whose resolved value of P includes the target, and is not the target itself. Body links and wikilinks in other front matter values never count.
- `propertySyncing` (the existing stored-both-sides relation) and `counterpart` are exclusive on one definition.

Save texts (`InvalidValue`, 422; our strings):

```python
COUNTERPART_NAME = "Name the other side in 1 to 60 characters, on one line."
COUNTERPART_KEY = "The other side's key can't be used."
COUNTERPART_KIND = "Only a relation can have an other side."
COUNTERPART_SYNCED = "A relation that syncs both ways can't also have a computed other side."
COUNTERPART_TAKEN = '{type} already has a property with the key "{key}".'
COUNTERPART_TAKEN_BY = '{type}\'s "{relation}" already uses the key "{key}" for its other side here.'  # fix pass: a target type's save that newly stores a key a counterpart naming it uses (our string)
```

Edit texts (`InvalidValue` → 422, our strings): `NO_COUNTERPART = 'This object has no "{key}" relation from {type}.'`; `WRONG_TYPE = '"{title}" isn\'t of type {type}.'`. A missing other object is reported in `skipped` (`"It's gone."`), a read-only one with its read-only reason.

### Seed vocabulary (`basicsetup`, design section 1, names only)

```python
ITOPS_TAGS = ("Windows", "Linux", "PowerShell", "ESXi", "VMware", "vSphere", "Synology", "NAS", "Docker",
              "Terraform", "Ansible", "AWS", "Office365", "SharePoint", "Active Directory", "Subnet", "Wifi",
              "Backup", "Automation", "Diagram", "Encryption", "Infrastructure", "Documentation", "Script",
              "AI", "LLM", "MCP", "API", "GitHub", "VM")
ITOPS_PROJECT_STATUSES = ("Back log", "In progress", "On hold", "Complete")   # guess G2
ITOPS_TASK_STATUSES = ("Not started", "Done")    # already the built-in Task's; nothing written (guess G2)
ITOPS_PRIORITIES = ("Low", "Medium", "High")
ITOPS_DEPARTMENTS = ("IT", "Finance", "All")
```

Tags get `color: bg-<THEME_COLORS[i % 18]>` by index (deterministic, our choice) and no body.

### Default templates (our strings; `ITOPS_TEMPLATE_SECTIONS: dict[str, tuple[str, ...]]`)

Body is one `## <section>` line per section, a blank line between: host Purpose, Access, Known issues; software Install notes, Licensing, Known issues; application Purpose, How it's built, Support; container Purpose, Configuration; configuration What it does, Settings, Why; location Access, Notes; network Addressing, Notes; person Role, Contact; vendor Contacts, Contract, Support; script Purpose, Usage; command Usage, Example; runbook When to use, Steps, Rollback; prompt Prompt, Notes; project Goal, Plan, Notes; incident Timeline, Impact, Cause, Follow-up; meeting Agenda, Notes, Action items. Source has no entry and no template. Front matter: `id`, `type: '<Name>'`, `template: <Name>` (as `Space.create_template` writes it).

### Schemas

Back end (`backend/objectapp/counterparts.py`):

```python
class CounterpartRow(TypedDict):
    key: str; name: str; sourceTypeId: str; sourcePropertyKey: str; paths: list[str]   # paths by title, then path
@dataclass(frozen=True)
class CounterpartSpec:
    source_type_id: str; source_key: str; source_name: str; key: str; name: str
    targets: tuple[str, ...]      # type ids; () = any
@dataclass(frozen=True)
class RelationMatch:              # for M30
    source_type_id: str; property_key: str; reversed: bool   # reversed: the name was the counterpart's
class CounterpartEditRequest(BaseModel):
    path: str; key: str; sourceTypeId: str
    add: list[str] = []; remove: list[str] = []; clientId: str | None = None
```

Front end (`frontend/src/api/types.ts`):

```ts
export interface Counterpart { name: string; key: string }
// PropertyOptions gains:
//   counterpart?: Counterpart | null                         // stored side (entity only)
//   counterpartOf?: { typeId: string; key: string }[]        // virtual defs only (API)
export interface CounterpartRow { key: string; name: string; sourceTypeId: string; sourcePropertyKey: string; paths: string[] }
// ObjectDetail gains   counterparts?: CounterpartRow[]
// TypeDef gains        counterparts?: PropertyDef[]          // API only, never saved
// GraphData gains      linkLabels?: (string | null)[]       // one per `links` pair
export type SpaceSetup = 'blank' | 'basic' | 'itops'
// TypeTemplate.section gains 'itOperations'
export interface CounterpartEditRequest { path: string; key: string; sourceTypeId: string; add: string[]; remove: string[]; clientId?: string }
export interface CounterpartEditResult { counterparts: CounterpartRow[]; written: { path: string; version: string }[]; skipped: { path: string; reason: string }[] }
```

A virtual definition (one per counterpart key on a type; `counterparts.counterpart_defs`): `{id: "counterpart:<key>", key, name, type: "entity", description: "", icon: {type: "iconify", val: "ph-arrows-left-right"}, visibility: "hideWhenEmpty", options: {isArray: true, allowedTypes: [<source type ids>], hasFixedSet: false, fixedSet: [], counterpartOf: [{typeId, key}, …]}}`. The definitions come in the order each key is first seen over the space's types in name order, then each type's properties (fix pass; Host in the starter: `runs`, `documentedIn`, `configuredBy`, `affectedBy`). `_API_ONLY_KEYS` gains `"counterparts"`, so `PUT /api/types/{id}` ignores it.

### Routes and events

| Route | Change | Errors |
|---|---|---|
| `GET /api/space` | each `types[i]` gains `counterparts: PropertyDef[]` | |
| `POST /api/spaces` | `setup` accepts `"itops"` | 422 unknown setup |
| `POST /api/space/setup` | accepts `"itops"`; message for others `Pick "basic", "itops" or "blank" as the starting point.` | 422, 409 as today |
| `GET /api/object` | gains `counterparts: CounterpartRow[]` | |
| `POST /api/object/counterpart` | `CounterpartEditRequest` → `CounterpartEditResult` | 404 no object at path; 422 `NO_COUNTERPART`, `WRONG_TYPE`; 423 |
| `POST /api/rows` | each row's `values[key]` = `[{target, path}]` (EntityRef, title as target) and `links[key]` = paths, per counterpart key of its type | |
| `GET /api/graph` | gains `linkLabels` | |
| `GET /api/type-gallery` | the IT ops entries, section `itOperations` | |
| `GET /api/v1/object`, `/api/v1/object/peek` | `values` carry counterpart values (from rows, hidden paths removed by `without_hidden`); plus `counterparts` with hidden paths removed | |

Events: each written object announces `ChangeEvent("changed", path, version, origin=clientId)`; the link index's `linked` (already sent with the first event) names the target, whose backlinks and counterparts changed. Setup announces `("types", "*", None)` as basic setup does; the seed files are announced as for any created object.

### Module signatures

```python
# basicsetup.py
ITOPS_TYPE_IDS: tuple[str, ...]
def itops_types() -> list[TypeDefinition]                         # fresh ids each call
def source_type() -> TypeDefinition                               # the Source type alone (fresh property ids); itops_types() uses it; M30 creates it in spaces without one
def sources_property() -> PropertyDefinition                      # the entity types' `sources` relation (fresh id); M30 adds it to other types
def itops_template(type_id: str) -> tuple[str, str]              # (template name, body) for one IT ops type; KeyError for "source"
def write_itops_types(root: Path, skip: Iterable[str] = ()) -> list[Path]   # types + templates; never replaces
def write_itops_tags(root: Path) -> list[Path]                   # seed Tags not already present (by folded title)
# typemodel.py (here, not in counterparts.py: counterparts imports typemodel, so this avoids a cycle)
def valid_counterpart(value: Any) -> bool                        # re-exported by counterparts.py
# counterparts.py
def counterpart_specs(types: Iterable[TypeDefinition]) -> list[CounterpartSpec]
def specs_for(type_id: str, types: Iterable[TypeDefinition]) -> list[CounterpartSpec]   # keys taken on the type dropped
def counterpart_defs(type_id: str, types: Iterable[TypeDefinition]) -> list[PropertyDefinition]
def check_type(t: TypeDefinition, types: Iterable[TypeDefinition]) -> str | None        # a save text, or None
def find_relation(types: Iterable[TypeDefinition], subject_type_id: str, object_type_id: str, name: str) -> RelationMatch | None
def edge_label(src_type: TypeDefinition | None, keys: Iterable[str]) -> str | None     # stored names, " · "
# linkindex.py
def LinkIndex.counterparts(self, path: str) -> list[CounterpartRow]
# space.py
def Space.counterparts(self, path: str) -> list[CounterpartRow]
def Space.counterpart_defs(self, type_id: str) -> list[PropertyDefinition]
def Space.edit_counterpart(self, path: str, key: str, source_type_id: str, add: list[str], remove: list[str]) -> CounterpartEdit
@dataclass
class CounterpartEdit: written: list[tuple[str, str]]; skipped: list[Skip]; counterparts: list[CounterpartRow]
# frontend client.ts
api.editCounterpart(req: CounterpartEditRequest): Promise<CounterpartEditResult>
```

`find_relation` matches `name` case-insensitively against a stored property's name (subject holds it, `reversed=False`) or a counterpart name (the object holds it, `reversed=True`), with the type pair allowed. `edge_label` joins the distinct names of the relation properties (any `entity`, not only counterparted) among `keys`.

### Consumed by M29 and M30

- M29 adds synced properties and `namePatterns` to Host, Network and Software: it edits `basicsetup.itops_types()` after this milestone (its plan owns that edit).
- M30 writes relations on the stored side with `Space.update_properties`, finds the stored side with `counterparts.find_relation`, and creates entities of the `ITOPS_TYPE_IDS` types. It creates the Source type from `basicsetup.source_type()` in a space without one, adds `basicsetup.sources_property()` to a type it distils into that lacks `sources`, and makes Source objects read-only; none of that is built here.

## Tasks

Each task: write the failing test, run it and see it fail, implement, run it and see it pass, commit. Each runs only its own tests and those of modules it touched (`uv run pytest backend/tests/test_m28_<x>.py -q`, `npx vitest run <files>`); the full suites run in T11. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Contract, stubs and types

**Files**
- Create: `backend/objectapp/counterparts.py` (the dataclasses, `CounterpartEditRequest`, the texts, `valid_counterpart` re-exported, every other function as a stub raising `NotImplementedError`), `backend/tests/test_m28_contract.py`, `frontend/src/object/CounterpartRows.tsx` (stub exporting `CounterpartRows` and `COUNTERPART_TEXT`), `frontend/src/api/m28contract.test.ts`
- Modify: `backend/objectapp/typemodel.py` (`valid_counterpart`; `option_shape_problems`: a `counterpart` that is neither None nor valid is bad, so `normalize_options` drops it; `_API_ONLY_KEYS` gains `"counterparts"`), `frontend/src/api/types.ts` (the Contract types), `frontend/src/api/client.ts` (`editCounterpart`), `frontend/src/test/mockApi.ts` (`counterpartRow()`, `counterpartDef()` helpers; `editCounterpart` mock)

**Interfaces**
- Produces: the Contract's schemas, texts and signatures; `valid_counterpart(value) -> bool`.

- [ ] **Step 1: Write the failing tests.** `test_counterpart_option_shape`: `option_shape_problems({"counterpart": "Runs"}) == ["counterpart"]`; `{"counterpart": {"name": "Runs", "key": "runs"}}` → `[]`; `{"counterpart": None}` → `[]`; `{"name": "", "key": "runs"}`, `{"name": "Runs", "key": "has space"}`, `{"name": "Runs", "key": "title"}`, `{"name": "a\nb", "key": "x"}`, `{"name": "x" * 61, "key": "x"}` all bad; `PropertyDefinition.from_json({... "type": "entity", "options": {"counterpart": 3}})` has no `counterpart` option. `test_counterparts_is_api_only`: `TypeDefinition.from_json({..., "counterparts": [...]}).extra` has no `counterparts`. TS: `m28contract.test.ts` type-checks a `CounterpartRow`, a `CounterpartEditResult`, `SpaceSetup` `'itops'`, `TypeTemplate['section']` `'itOperations'`, and `api.editCounterpart` POSTs to `/api/object/counterpart`.
- [ ] **Step 2: Run them.** `uv run pytest backend/tests/test_m28_contract.py -q`; `npx vitest run src/api/m28contract.test.ts`. Expected: FAIL (`counterparts` module missing).
- [ ] **Step 3: Implement** the stubs and the two `typemodel.py` changes.
- [ ] **Step 4: Run them, plus `uv run pytest backend/tests/test_typemodel*.py -q` and `npx tsc -b --noEmit`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): contract for counterparts and the IT ops setup`.

### Task 2: The IT ops types, templates, vocabulary and fixture

**Files**
- Modify: `backend/objectapp/basicsetup.py` (`ITOPS_TYPE_IDS`, `itops_types`, `ITOPS_TEMPLATE_SECTIONS`, `itops_template`, `write_itops_types`, `ITOPS_TAGS` and the other vocabulary, `write_itops_tags`; module docstring lists the our-choices)
- Create: `backend/tests/test_m28_itops.py`, fixture `backend/tests/fixtures/space-itops/` (below)

**Interfaces**
- Consumes: `_prop`, `_label`, `_relation`, `basic_types`, `workfields.field_defs`, `_completed`, `write_type_json`, `atomic_write`, `join_object`/`set_keys` (as `Space.create_template` and `ensure_tag` build files).
- Produces: the Contract's `basicsetup` names; the fixture.

Fixture `space-itops/` (synthetic): `.object/space.json` (`{"name": "IT ops test", "setup": "itops"}`), `.object/types/*.json` written once by `write_itops_types` (committed), and:
- `Hosts/APP-TEST-01.md` (**CRLF + BOM**; category Server, environment Test, operatingSystem `[[Windows Server 2022]]`, locatedAt `[[Rack A]]`, aliases `[app01]`); `Hosts/DB-TEST-01.md` (operatingSystem `[[Windows Server 2022]]`)
- `Software/SQL Server 2019.md` (product SQL Server, version 2019, vendor `[[Example Vendor]]`); `Software/Windows Server 2022.md`
- `Applications/Inventory app.md` (status Live, runsOn `[[APP-TEST-01]]`, uses `[[SQL Server 2019]]`, ownedBy `[[Sam Example]]`); `Applications/Old app.md` (runsOn `[[Missing host]]`)
- `Containers/inventory-web.md` (runsOn `[[app01]]` — the alias, partOf `[[Inventory app]]`)
- `Configurations/Backup schedule.md` (kind Scheduled task, appliesTo `[[DB-TEST-01]]`)
- `Locations/Main site.md` (kind Site); `Locations/Rack A.md` (kind Rack, partOf `[[Main site]]`)
- `Networks/Server VLAN.md` (kind VLAN, range `10.0.0.0/24`, vlanId 10, locatedAt `[[Main site]]`)
- `People/Sam Example.md`; `Vendors/Example Vendor.md`
- `Runbooks/Restart the inventory app.md` (kind Runbook, covers `[[Inventory app]]`, `[[APP-TEST-01]]`)
- `Incidents/Inventory app slow.md` (status Open, severity SEV3, affects `[[Inventory app]]`)
- `Pages/Rack notes.md` (body text `See [[APP-TEST-01]].`; a front matter `runsOn: '[[DB-TEST-01]]'` on a Page)
- `Templates/Hosts/Host.md` (the Host template, plus `locatedAt: '[[Rack A]]'` so a template links to a Host's target)

- [ ] **Step 1: Write the failing tests** in `test_m28_itops.py`:
  - `test_itops_type_ids`: `[t.id for t in itops_types()] == list(ITOPS_TYPE_IDS)` (17); names and plurals as the Contract table.
  - `test_host_properties`: Host's own keys in order `category, roles, ipAddress, fqdn, department, environment, operatingSystem, locatedAt, network, ownedBy, sources, notes`; Category options exactly `["Server", "Workstation", "Network device", "Printer", "NAS", "Firewall", "VPN"]`; Roles multi with `["DNS", "DHCP", "Active Directory", "File server", "Print server", "RDS", "Hypervisor", "Firewall/VPN"]`; Environment `["Production", "Test", "Development"]`; `operatingSystem.options == {isArray: False, allowedTypes: ["software"], …, "counterpart": {"name": "Installed on", "key": "installedOn"}}`; `ownedBy.allowedTypes == ["person", "vendor"]`.
  - `test_every_counterpart_pair` (parametrised over the Contract's counterpart table): source key, `allowedTypes`, `{name, key}` exact.
  - `test_source_type`: `source_type().id == "source"`, name Source / Sources; own keys `category, system, notes`; Category options exactly `["Wiki page", "Document", "Spreadsheet", "Presentation", "PDF", "Diagram", "Email", "Ticket", "Chat", "Web page", "Image", "Note"]`; System `["SharePoint", "Wiki", "Notion", "Obsidian", "Anytype", "Files", "Markdown"]`; no `entity` property; `sources_property()` is `entity`, multi, `allowedTypes == ["source"]`, counterpart `{"name": "Distilled into", "key": "distilledInto"}`, visibility `hideWhenEmpty`; the nine entity types have it just before `notes` and the other eight IT ops types don't.
  - `test_option_lists` (parametrised): Software, Application, Container, Configuration, Location, Network, Vendor, Script, Command, Runbook, Prompt, Incident property names and options exactly as the Contract (e.g. Severity `["SEV1", "SEV2", "SEV3", "SEV4"]`, Shell `["PowerShell", "Bash", "cmd", "macOS"]`, Language `["PowerShell", "Bash", "Python", "AWS CLI"]`).
  - `test_basic_variants`: Person = basic Person's keys + `department` before `notes`; Meeting's `meetingType` options end with `["Operations", "Helpdesk"]`; Project has `affects`, `priority` and the four statuses with statusCategory `["not-started", "in-progress", "blocked", "done"]`, and `workrules.done_option(status) == "Complete"`; Incident `is_work_type`, has no work-field `cause` label (its `cause` is `text`), `deskResolved.name == "Desk resolved"`, `done_option == "Resolved"`.
  - `test_no_credential_property`: no property name or key in any IT ops type matches `(?i)password|secret|credential|api key|token`.
  - `test_write_itops_types_never_replaces`: in a temp root with `.object/types/host.json` = `b"{}"` and `Templates/Hosts/Host.md` present, `write_itops_types(root)` keeps both bytes, writes the other 16 types and 15 templates (Source has none), and every written type's `templates.defaultTemplateId` is its template's id; `skip=["person"]` writes no person type or template.
  - `test_templates`: `itops_template("host") == ("Host", "## Purpose\n\n## Access\n\n## Known issues\n")`; every id in `ITOPS_TYPE_IDS` but `source` has sections.
  - `test_write_itops_tags`: writes 30 files `Tags/<name>.md` with `type: 'Tag'`; with `Tags/windows.md` titled `Windows` already present, writes 29 and keeps it; a second call writes none.
  - `test_fixture_types_match`: the fixture's type JSON, loaded, equals `itops_types()` up to property ids and template ids (guards the committed fixture).
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m28_itops.py -q`. Expected: FAIL (names missing).
- [ ] **Step 3: Implement** the Contract's `basicsetup` names. Labels with statusCategory are built from `label_options(texts)` with the category added per option. Files go through `atomic_write`; a template or type whose path exists is skipped.
- [ ] **Step 4: Run it, plus `uv run pytest backend/tests/test_basicsetup.py -q`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): the IT ops types, templates and seed vocabulary`.

### Task 3: The setup choice and the gallery's default template

**Files**
- Modify: `backend/objectapp/space.py` (`apply_setup` accepts `"itops"`; `create_type` writes the IT ops template for an IT ops gallery key), `backend/objectapp/spaces.py` (`create_space` accepts `"itops"`), `backend/objectapp/spaceconfig.py` (`needs_setup` also checks `ITOPS_TYPE_IDS`; docstring), `backend/objectapp/server.py` (`CreateSpaceRequest.setup: Literal["blank", "basic", "itops"]`, `post_space_setup` text)
- Create: `backend/tests/test_m28_setup.py`
- Modify (existing tests whose text changes): the H2 setup test asserting the 422 text (find with `grep -rn 'as the starting point' backend/tests`)

**Interfaces**
- Consumes: T2's `itops_types`, `write_itops_types`, `write_itops_tags`, `itops_template`.
- Produces: `Space.apply_setup("itops")`; `create_space(name, location, setup="itops")`.

- [ ] **Step 1: Write the failing tests:**
  - `test_create_space_itops`: `create_space("Ops", tmp, "itops")` → `.object/space.json` has `setup: "itops"`, 17 type files, 16 templates, 30 tags; opening it as a `Space` lists the types and `needs_setup` is False.
  - `test_apply_setup_itops`: an empty space; `space.apply_setup("itops")` → `space.type_by_id("host")` exists, `space.list_templates("host")[0].title == "Host"`, `space.create_object("host", "SRV-TEST-02")` has body `## Purpose\n\n## Access\n\n## Known issues\n`, a Tag `Windows` resolves.
  - `test_itops_setup_keeps_what_exists` (Review Focus 5): a space with a hand-made `.object/types/host.json`, `Templates/Hosts/Host.md` and `Tags/Windows.md`; after `apply_setup("itops")` those three are byte-identical, the other types are written, no second Windows tag; through `create_app`, a second `POST /api/space/setup {"setup": "itops"}` → 409 `"This space already has a starting point."`; `POST /api/space/setup {"setup": "x"}` → 422 `Pick "basic", "itops" or "blank" as the starting point.`
  - `test_needs_setup_with_itops_types`: a space with only `.object/types/host.json` and no `setup` key → `needs_setup` False.
  - `test_gallery_itops_type_gets_its_template`: `space.create_type("Host", "Hosts", template="host")` → the type has a default template with Host's sections; `create_type(..., template="film")` still creates no template object.
  - `test_setup_reads_write_nothing`: `GET /api/space` on a fresh empty folder writes no file (snapshot).
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m28_setup.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** `apply_setup("itops")` calls `write_itops_types(self.root, skip=<ids already in self.types>)` and `write_itops_tags(self.root)`, then loads the new types (`_sort_types`, `_types_changed` per id) and rescans the written `.md` paths (`rescan_file`), then records `setup`. `create_space` writes them after `space.json`. `create_type` with a key in `ITOPS_TYPE_IDS` adds the template through `create_template(t.id, name)` plus its body, and sets `defaultTemplateId`.
- [ ] **Step 4: Run it, plus `uv run pytest backend/tests -q -k "setup or create_space or gallery or create_type"`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): IT operations as a starting point`.

### Task 4: Counterparts: specs, the index and rows

**Files**
- Modify: `backend/objectapp/counterparts.py` (every function), `backend/objectapp/linkindex.py` (`counterparts`), `backend/objectapp/rows.py` (counterpart values in `_row`)
- Create: `backend/tests/test_m28_counterparts.py`

**Interfaces**
- Consumes: T1's names; `LinkIndex._in`, `link_keys`, `Space._summaries`, `Space.types`; the `space-itops` fixture (T2).
- Produces: `counterpart_specs`, `specs_for`, `counterpart_defs`, `check_type`, `find_relation`, `edge_label`; `LinkIndex.counterparts(path) -> list[CounterpartRow]`; rows with counterpart values.

- [ ] **Step 1: Write the failing tests** (on a copy of `space-itops`):
  - `test_host_rows`: `space.links.counterparts("Hosts/APP-TEST-01.md")` holds rows (`key`, `sourceTypeId`, `sourcePropertyKey`, `paths`): `runs`/application/`runsOn` `["Applications/Inventory app.md"]`; `runs`/container/`runsOn` `["Containers/inventory-web.md"]` (the alias link counts); `configuredBy`/configuration/`appliesTo` `[]`; `documentedIn`/script/`covers` `[]`; `documentedIn`/runbook/`covers` `["Runbooks/Restart the inventory app.md"]`; `affectedBy` from project and incident `[]`. `documentedIn`/command (an "any" source with no value) is absent.
  - `test_other_targets`: Software `Windows Server 2022` → `installedOn` `["Hosts/APP-TEST-01.md", "Hosts/DB-TEST-01.md"]`; `SQL Server 2019` → `usedBy` `["Applications/Inventory app.md"]`; Location `Main site` → `contains` from location (`Rack A`) and network (`Server VLAN`); `Rack A` → `contains` from host (`APP-TEST-01`) — the template's link doesn't count; Person `Sam Example` → `owns` from application; Application `Inventory app` → `containers` `["Containers/inventory-web.md"]`, `affectedBy` from incident `["Incidents/Inventory app slow.md"]`.
  - `test_only_resolved_relation_values_count` (Review Focus 4): `Pages/Rack notes.md`'s body link and its `runsOn` front matter key (a Page) add nothing to `DB-TEST-01`'s or `APP-TEST-01`'s rows; `Old app`'s unresolved `[[Missing host]]` adds nothing anywhere; a self link (an Application whose `runsOn` names itself, written in the test) adds nothing; a path-form link `[[Hosts/DB-TEST-01]]` counts.
  - `test_rename_keeps_rows`: rename `APP-TEST-01` to `APP-TEST-09` (`space.rename`, which relinks) → its `runs` row still lists Inventory app.
  - `test_bad_counterparts_are_dropped_and_stored_keys_win` (Review Focus 3): edit `application.json` on disk so `runsOn.options.counterpart` is `"Runs"` → after a reload, no `runs` row from application and no exception; give Host a stored property `runs` (text) and a front matter line `runs: hand typed` on APP-TEST-01 → no `runs` rows on Host, and the row value under `runs` is the stored text.
  - `test_counterpart_defs`: `counterpart_defs("host", types)` keys `["runs", "configuredBy", "documentedIn", "affectedBy"]` (first-seen order over types, then properties), `runs.options.allowedTypes == ["application", "container"]`, `counterpartOf == [{"typeId": "application", "key": "runsOn"}, {"typeId": "container", "key": "runsOn"}]`, `documentedIn.counterpartOf` lists script, command and runbook, visibility `hideWhenEmpty`, id `counterpart:runs`; `counterpart_defs("source", types)` keys `["distilledInto"]`, its `counterpartOf` the nine entity types' `sources`.
  - `test_rows_carry_counterparts`: `space.rows(["host"], None, None, None, False)` row for APP-TEST-01 has `values["runs"] == [{"target": "Inventory app", "path": "Applications/Inventory app.md"}, {"target": "inventory-web", "path": "Containers/inventory-web.md"}]` (by title) and `links["runs"]` the two paths.
  - `test_check_type`: `check_type` answers `COUNTERPART_KIND` for a `label` with a counterpart, `COUNTERPART_SYNCED` for an entity with both `propertySyncing` and `counterpart`, `COUNTERPART_TAKEN.format(type="Host", key="category")` for Application `runsOn` with key `category`, `None` for every starter type.
  - `test_find_relation`: `find_relation(types, "application", "host", "runs on") == RelationMatch("application", "runsOn", False)`; `find_relation(types, "host", "application", "Runs") == RelationMatch("application", "runsOn", True)`; `find_relation(types, "host", "location", "Contains")` is None (wrong way round: Location contains the Host); `find_relation(types, "location", "host", "Contains") == RelationMatch("host", "locatedAt", True)`.
  - `test_edge_label`: `edge_label(application, ["runsOn", "uses"]) == "Runs on · Uses"`; `edge_label(page, ["runsOn"])` is None (no definition).
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m28_counterparts.py -q`. Expected: FAIL (`NotImplementedError`).
- [ ] **Step 3: Implement.** `LinkIndex.counterparts` walks `specs_for(target type)`, and for each spec the sources in `self._in.get(path)` of type `spec.source_type_id` (non-template) whose `link_keys(src, path)[1]` contains `spec.source_key`; paths sorted as `backlinks` sorts them; explicit-target specs always yield a row, "any" specs only with paths. `_row` adds, after the property loop, one value per `counterpart_defs` key the row doesn't already have (the stored property wins), merging the rows with that key.
- [ ] **Step 4: Run it, plus `uv run pytest backend/tests/test_linkindex*.py backend/tests/test_rows*.py -q`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): computed counterparts in the index and rows`.

### Task 5: Space and routes: reading and editing counterparts

**Files**
- Modify: `backend/objectapp/space.py` (`counterparts`, `counterpart_defs`, `edit_counterpart`, `CounterpartEdit`; `save_type` calls `counterparts.check_type`), `backend/objectapp/server.py` (`space_info` types' `counterparts`, `GET /object` `counterparts`, `POST /object/counterpart`), `backend/objectapp/api_v1.py` (`read` and `peek` add `counterparts`, hidden paths removed)
- Create: `backend/tests/test_m28_space.py`, `backend/tests/test_m28_api.py`

**Interfaces**
- Consumes: T4's `LinkIndex.counterparts`, `counterpart_defs`, `check_type`; `Space.update_properties`, `Space._link_text`, `Skip`.
- Produces: the Contract's `Space` methods and routes.

- [ ] **Step 1: Write the failing tests.** `test_m28_space.py` (copy of `space-itops`, committed to a throw-away git repo):
  - `test_counterpart_edit_touches_only_the_stored_side` (Review Focus 1): `space.edit_counterpart("Hosts/DB-TEST-01.md", "runs", "application", add=["Applications/Inventory app.md"], remove=[])` → `written == [("Applications/Inventory app.md", <version>)]`; `git diff` names only that file and only its `runsOn` and `lastUpdated` lines (`hunk_keys`); its value is `['[[APP-TEST-01]]', '[[DB-TEST-01]]']`; `Hosts/DB-TEST-01.md` bytes unchanged; the returned `counterparts` row `runs`/application lists Inventory app. Then `remove=["Applications/Inventory app.md"]` on `Hosts/APP-TEST-01.md` (CRLF+BOM) leaves APP-TEST-01's bytes unchanged and Inventory app's `runsOn` `['[[DB-TEST-01]]']`.
  - `test_edit_into_a_crlf_file`: the test rewrites `Configurations/Backup schedule.md` as CRLF+BOM (and commits it); `edit_counterpart("Hosts/APP-TEST-01.md", "configuredBy", "configuration", add=["Configurations/Backup schedule.md"])` → that file keeps CRLF and its BOM, its `appliesTo` is `['[[DB-TEST-01]]', '[[APP-TEST-01]]']`, and only `appliesTo` and `lastUpdated` changed.
  - `test_single_source_is_replaced`: `edit_counterpart("Software/SQL Server 2019.md", "installedOn", "host", add=["Hosts/DB-TEST-01.md"])` → DB-TEST-01's `operatingSystem` is `[[SQL Server 2019]]` (replaced, the old value gone).
  - `test_edit_errors`: unknown key → `InvalidValue('This object has no "nope" relation from Application.')`; adding `People/Sam Example.md` to a `runs` row from application → `InvalidValue('"Sam Example" isn\'t of type Application.')`; a path that doesn't exist → in `skipped` with `"It's gone."`, nothing written; adding a path already linked writes nothing (`written == []`).
  - `test_save_type_checks_counterparts` (Review Focus 3): `save_type` of Application with `runsOn.options.counterpart = {"name": "Runs", "key": "category"}` → `InvalidValue('Host already has a property with the key "category".')`; through `PUT /api/types/application` with `{"name": "", "key": "runs"}` → 422 `The options of Runs on are not valid: counterpart.` (the route's existing `option_shape_problems` check runs first) and the type file is unchanged; `space.save_type` of a definition built in Python with `options.counterpart = {"name": "", "key": "runs"}` (bypassing `from_json`) → `InvalidValue(COUNTERPART_NAME)`.
  `test_m28_api.py` (`create_app` on a copy, no `ui_key`):
  - `test_object_has_counterparts`: `GET /api/object?path=Hosts/APP-TEST-01.md` → `counterparts` equal `space.counterparts(...)`.
  - `test_space_types_have_counterpart_defs`: `GET /api/space` → `host.counterparts[*].key == ["runs", "configuredBy", "documentedIn", "affectedBy"]`; `PUT /api/types/host` with the served JSON (counterparts included) leaves the file without a `counterparts` key.
  - `test_post_counterpart`: `POST /api/object/counterpart` as the first T5 case → 200 `CounterpartEditResult`; a `changed` event for `Applications/Inventory app.md` whose `linked` includes `Hosts/DB-TEST-01.md`; 404 for a missing `path`; 422 texts as above.
  - `test_v1_object_counterparts`: a read token; `GET /api/v1/object?path=Hosts/APP-TEST-01.md` → `values.runs` has the two EntityRefs and `counterparts` the rows; with `Containers/` excluded from agents (the existing exclusion setting), `inventory-web` is in neither.
  - `test_reads_write_nothing` (Review Focus 2): snapshot the space and the state dir; `GET /api/space`, `GET /api/object` for every fixture object, `POST /api/rows` (all types), `GET /api/graph`, `GET /api/type-gallery`, `GET /api/v1/object` → no file changed or added.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m28_space.py backend/tests/test_m28_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** `edit_counterpart` validates the key against `specs_for(target type)` with `source_type_id`, then per other path (sorted): read it, build its new value from its current refs (append `{target: self._link_text(path, other)}`, or drop refs resolving to `path`; a single-valued source gets exactly the new ref), call `update_properties(other, {key: refs}, version)`; on `RevisionConflict` re-read once and retry; other failures go to `skipped`. `save_type` calls `check_type(t, <types with t replacing its stored version>)` before planning rewrites.
- [ ] **Step 4: Run them, plus `uv run pytest backend/tests -q -k "object or types or v1 or rows"`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): read and edit counterparts`.

### Task 6: Graph edge labels

**Files**
- Modify: `backend/objectapp/graphdata.py` (`linkLabels`), `frontend/src/graph/GraphCanvas.tsx` (edge `label` attribute; `renderEdgeLabels: true`; the edge reducer blanks labels except on edges of the hovered or highlighted node, as node labels already are), `frontend/src/graph/useGraphData.ts` (pass `linkLabels` through)
- Create: `backend/tests/test_m28_graph.py`, `frontend/src/graph/edgeLabels.m28.test.tsx`

**Interfaces**
- Consumes: T4's `edge_label`; `LinkIndex.link_keys`.
- Produces: `GraphData.linkLabels` (one per pair, null for body-only links).

- [ ] **Step 1: Write the failing tests.** `test_graph_labels` (space-itops): the pair Inventory app ↔ APP-TEST-01 has label `"Runs on"`; Inventory app ↔ SQL Server 2019 `"Uses"`; Rack notes ↔ APP-TEST-01 (body link only) `None`; `len(linkLabels) == len(links) // 2`; a pair linked both ways by relations joins both names with `" · "` (source a's names first). TS: with `linkLabels`, hovering a node shows the label of its edges only (`testSigma` reducer output: label set on the hovered node's edges, `''` elsewhere); without `linkLabels` no edge has a label.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m28_graph.py -q`; `npx vitest run src/graph/edgeLabels.m28.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** For each pair `(a, b)`: names from `edge_label(type(a), link_keys(a, b)[1])` and `edge_label(type(b), link_keys(b, a)[1])`, the non-null ones joined with `" · "`, else None.
- [ ] **Step 4: Run them, plus `uv run pytest backend/tests/test_graph*.py -q` and `npx vitest run src/graph`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): the graph labels relation edges`.

### Task 7: The gallery's IT ops entries

**Files**
- Modify: `backend/objectapp/typetemplates.py` (`_from_itops(tid)`; the IT ops `TypeTemplate`s, section `"itOperations"`, after `planningAndReflection` and before the unsectioned row; `TEMPLATE_QUERIES` for each), `frontend/src/types/templateQueries.fixture.json` (regenerated from `template_query_fixture()`, the way the existing test says)
- Create: `backend/tests/test_m28_gallery.py`
- Modify (existing counts): the gallery tests asserting `TEMPLATE_KEYS` (find with `grep -rn TEMPLATE_KEYS backend/tests frontend/src`)

**Interfaces**
- Consumes: T2's `itops_types`.
- Produces: gallery keys `host, software, application, container, configuration, location, network, vendor, script, command, runbook, prompt, incident` (Person, Meeting and Project stay the basic entries; our call).

Queries (our choice): host "Production hosts" (`environment` contains Production; sort title asc; table); software "Software by product" (sort `product` asc, `version` desc; table); application "Live applications" (`status` contains Live; title asc); container "All containers A-Z"; configuration "All configurations A-Z"; location "Sites" (`kind` contains Site); network "All networks A-Z" (table); vendor "Contracts ending" (`contractEnds` isNotEmpty; sort `contractEnds` asc); script "Recently updated scripts" (`lastUpdated` desc); command "All commands A-Z"; runbook "Runbooks to review" (sort `lastReviewed` asc); prompt "All prompts A-Z"; incident "Open incidents" (`status` contains Open; `lastUpdated` desc).

- [ ] **Step 1: Write the failing tests:** `test_gallery_has_itops`: `template_catalog([])` has the 13 keys in that order with `section == "itOperations"`, names and descriptions as the starter types; `test_built_relations_resolve`: `build_template("application", [<types made from host and software>])` → `runsOn.allowedTypes == [<host type id>]` and keeps `counterpart {"Runs", "runs"}`; with no host type, `allowedTypes == []` and the counterpart is kept; `test_queries_build`: `template_query(key, t)` succeeds for every IT ops key (no `KeyError`); `test_fixture_is_current`: the committed frontend fixture equals `template_query_fixture()`.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m28_gallery.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate the fixture.
- [ ] **Step 4: Run it, plus `uv run pytest backend/tests -q -k "template or gallery"` and `npx vitest run src/types/templateQueries.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): IT ops types in the gallery`.

### Task 8: The starting point, Create new space and the gallery section (front end)

**Files**
- Modify: `frontend/src/spaces/CreateSpaceDialog.tsx` (`CREATE_SPACE_TEXT.itopsLabel = 'IT operations'`, `itopsDescription = 'Includes hosts, software, applications, runbooks and incidents.'`; `SETUPS` gains `{value: 'itops', icon: 'ph-hard-drives', …}` between basic and blank), `frontend/src/spaces/StartingPointDialog.tsx` (reload the link index for any setup but `'blank'`), `frontend/src/types/CreateTypeDialog.tsx` (section title `itOperations: 'IT operations'`; `SECTIONS` order as T7), tests `spaces/CreateSpaceDialog.test.tsx`, `spaces/StartingPointDialog.test.tsx`, `types/CreateTypeDialog.test.tsx`

**Interfaces**
- Consumes: T1's `SpaceSetup`, `TypeTemplate['section']`.

- [ ] **Step 1: Write the failing tests:** the Create dialog lists three choices in the order "Start with basic setup", "IT operations", "Empty space" with the description text verbatim; picking IT operations sends `setup: 'itops'`; the starting point dialog's IT operations button calls `api.spaceSetup('itops')` and reloads the link index; the gallery shows an "IT operations" heading over the `itOperations` entries (mock gallery).
- [ ] **Step 2: Run** `npx vitest run src/spaces src/types/CreateTypeDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): IT operations in the starting point and the gallery`.

### Task 9: Counterpart rows on the object page and in views (front end)

**Files**
- Modify: `frontend/src/object/CounterpartRows.tsx` (fill the T1 stub), `frontend/src/object/PropertyPanel.tsx` (renders `CounterpartRows` after the type's own properties, before Backlinks; same row chrome; `hideWhenEmpty` rows follow the panel's existing empty-row toggle), `frontend/src/object/ObjectView.tsx` (passes `detail.counterparts`, `onEditCounterpart`; `refreshComputed` also copies `counterparts` and runs when the type has `counterparts`), `frontend/src/views/properties.ts` (`propertyChoices` adds each view type's `counterparts` defs after its own), `frontend/src/views/table/tableConfig.ts` (`tableDefs` includes them, read-only cells)
- Create: `frontend/src/object/CounterpartRows.test.tsx`, `frontend/src/views/counterparts.m28.test.ts`

**Interfaces**
- Consumes: T1's types and `api.editCounterpart`; `RelationCell`; `cellForDef`.
- Produces: `CounterpartRows({rows, defs, readOnly, onEdit, onOpenObject})`, where `onEdit(key: string, add: string[], remove: string[]): Promise<void>` and `COUNTERPART_TEXT = {mixed: 'Pick an object of {types}.'}` (our string).

- [ ] **Step 1: Write the failing tests:**
  - `CounterpartRows.test.tsx`: rows with the same key merge into one row labelled by the name ("Documented in" once, its chips from script and runbook rows); the chips show titles from the link index; the picker is a `RelationCell` over the virtual def (`allowedTypes` the merged sources), so it offers only Scripts, Commands and Runbooks; picking a Runbook calls `api.editCounterpart({path, key: 'documentedIn', sourceTypeId: 'runbook', add: [<path>], remove: []})` (the source taken from the picked object's type); removing a chip sends `remove` with the source of the row holding it; the result's `counterparts` replace the rows without a reload; a 422 shows its text in the row; `readOnly` shows chips only.
  - `PropertyPanel` (in `CounterpartRows.test.tsx` with the real panel): on a Host with an empty `configuredBy` row the row is hidden until the panel shows empty properties, `runs` is shown.
  - `counterparts.m28.test.ts`: `propertyChoices([host])` includes `runs` (kind `entity`); `filter.ts` "contains" on `runs` with Inventory app's path keeps APP-TEST-01's row; `sort.ts` sorts by `runs`; `group.ts` groups by `runs` (a row in each linked object's group), all on rows shaped as T4's `test_rows_carry_counterparts`.
- [ ] **Step 2: Run** `npx vitest run src/object/CounterpartRows.test.tsx src/views/counterparts.m28.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** No change to `filter.ts`, `sort.ts` or `group.ts` is expected (counterpart values are ordinary `entity` values); if one is needed, say so in the report (they belong to no task here).
- [ ] **Step 4: Run them, plus `npx vitest run src/object src/views`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): counterpart rows on the object page and in views`.

### Task 10: Naming the other side in property settings (front end)

**Files**
- Modify: `frontend/src/properties/PropertySettings.tsx` (for an `entity` property without `propertySyncing`: a text field "Show on the other side as" (our label), placeholder "No other side" (our string); a new name sets `options.counterpart = {name, key: counterpartKey(name)}`, a changed name keeps the key, an emptied field sets `counterpart: null`; hidden for a synced relation, with the note "This relation already syncs both ways." (our string))
- Create: `frontend/src/properties/counterpartKey.ts` (`counterpartKey(name: string, taken: Set<string>): string`), `frontend/src/properties/PropertySettings.counterpart.test.tsx`

**Interfaces**
- Consumes: T1's `Counterpart`; the type save path `PropertySettings` already uses (a 422 shows the server's text, as other option errors do).

- [ ] **Step 1: Write the failing tests:** `counterpartKey('Runs', new Set()) == 'runs'`, `('Used by', …) == 'usedBy'`, `('Documented in', new Set(['documentedIn'])) == 'documentedIn2'`, `('Été', …) == 'ete'`, `('日本', …) == 'otherSide'` (fallback, our choice); typing "Runs" on Application's Runs on saves `counterpart: {name: 'Runs', key: 'runs'}`; renaming to "Hosts it" keeps `key: 'runs'`; clearing saves `null`; a synced relation shows the note and no field; a 422 `Host already has a property with the key "category".` is shown.
- [ ] **Step 2: Run** `npx vitest run src/properties/PropertySettings.counterpart.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `taken` is the union of the allowed target types' stored keys (from the link index's types).
- [ ] **Step 4: Run it, plus `npx vitest run src/properties`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(m28): name a relation's other side`.

### Task 11: Integrate: acceptance and docs

**Files**
- Create: `scripts/m28_acceptance.py`, `docs/superpowers/plans/m28-acceptance.md`
- Modify: `docs/behavior-catalog.md` (§3 gallery: the IT operations group; §4: "Pick a starting point" has three choices; §5: counterpart rows; §7: graph edge labels — each marked "Object's own, M28"), `docs/superpowers/plans/remaining-work.md` (M28 status line), `CONTINUE.md` (M28 built; M29 next)

**Interfaces**
- Consumes: everything above; `scripts/m2_acceptance.py` helpers (`Http`, `Run`, `commit`, `git`, `snapshot`, `changed_paths`, `hunk_keys`, `free_port`).

- [ ] **Step 1: Write `scripts/m28_acceptance.py [SPACE] [--keep]`** (default SPACE `backend/tests/fixtures/space-itops`). It copies SPACE to a temp folder (SPACE is never touched), commits the copy to a throw-away git repo, sets `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` to temp paths outside it, serves `create_app` on a free `127.0.0.1` port and checks over HTTP, printing `[ok]`/`[FAIL]` per check and `RESULT: PASS` at the end (non-zero exit on any failure). No agent runs, so the fake `claude` is not needed.
  1. reads write nothing: `GET /api/space`, `GET /api/object` of every object, `POST /api/rows`, `GET /api/graph`, `GET /api/type-gallery` → `git status` clean;
  2. `POST /api/spaces {"name": "Ops", "location": <temp>, "setup": "itops"}` → the new folder has 17 types, 16 templates and 30 tags; a new empty folder opened with `POST /api/space/setup {"setup": "itops"}` gets the same; a second call → 409;
  3. APP-TEST-01's counterparts: Runs (Inventory app, inventory-web), Documented in (Restart the inventory app); Rack A's Contains lists APP-TEST-01; Windows Server 2022's Installed on lists both hosts;
  4. `POST /api/object/counterpart` adds Inventory app to DB-TEST-01's Runs → only `Applications/Inventory app.md` changed, keys `runsOn` and `lastUpdated` (`hunk_keys`); DB-TEST-01's file unchanged;
  5. remove it again from APP-TEST-01 (CRLF+BOM) → APP-TEST-01's bytes unchanged;
  6. `POST /api/rows {"typeIds": ["host"]}` → APP-TEST-01's `values.runs` has two EntityRefs;
  7. `GET /api/graph` → the Inventory app ↔ APP-TEST-01 pair is labelled `Runs on`;
  8. `PUT /api/types/application` with `runsOn`'s counterpart key `category` → 422 `Host already has a property with the key "category".`; the type file unchanged;
  9. `GET /api/v1/object` with a read token made through `/api/integrations/tokens` → `counterparts` present;
  10. `git status` lists only the files the checks changed (Inventory app) and nothing in `.object/`.
- [ ] **Step 2: Write `docs/superpowers/plans/m28-acceptance.md`**: how to run the script, then hand checks for Gene (`- [ ]`) on a copy of his space:
  - [ ] "Create new space" offers Start with basic setup, IT operations and Empty space; IT operations makes a space whose sidebar lists Host, Software, Application, … Source, Incident, Meeting.
  - [ ] An empty folder opened with `--space` asks "Pick a starting point" with the same three choices.
  - [ ] A new Host opens with Purpose, Access and Known issues, and its properties (Category, Roles, IP address, FQDN, …) shown.
  - [ ] Tags lists the 30 seed tags; none is tied to a past employer or is personal.
  - [ ] Link an Application to a Host with Runs on: the Host shows a "Runs" row with the Application; add a second Application from the Host's Runs row: the Application's file changes, the Host's doesn't (git or version history).
  - [ ] A Host shows one "Documented in" row for scripts, commands and runbooks together.
  - [ ] On the Hosts type page, filter, sort and group by Runs.
  - [ ] The graph labels a Runs on edge when you hover the Host.
  - [ ] In an existing space, the gallery's IT operations group adds Host alone; adding Application later makes Runs on point at it.
  - [ ] Property settings of a relation: "Show on the other side as" names its other side; the target shows the new row.
  - [ ] Opening the space and browsing changes no file (git status clean).
  - [ ] Check the guesses G1-G4 in the plan's "Our calls".
- [ ] **Step 3: Run the gate:** `uv run pytest backend/tests -q`; `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`; `uv run python scripts/m28_acceptance.py` (prints `RESULT: PASS`); `uv run python scripts/m8_acceptance.py` and `scripts/m22_acceptance.py` (modules touched: setup, basic types, work fields).
- [ ] **Step 4: Commit** `test(m28): acceptance script and hand checks; docs status`.

## Shared files and ordering

| Shared file | Owner | Others needing a change say so in their report |
|---|---|---|
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts` | T1 | T6, T8-T10 |
| `backend/objectapp/typemodel.py` | T1 | |
| `backend/objectapp/counterparts.py` | T1 creates; T4 fills | T5, T6 consume |
| `frontend/src/object/CounterpartRows.tsx` | T1 creates (stub); T9 fills | |
| `backend/objectapp/basicsetup.py`, fixture `backend/tests/fixtures/space-itops/` | T2 | T3, T4, T5, T6, T7, T11 read them |
| `backend/objectapp/space.py` | T3, then T5 (in order, track B1) | |
| `backend/objectapp/server.py` | T3, then T5 (in order, track B1) | |
| `backend/objectapp/spaces.py`, `spaceconfig.py` | T3 | |
| `backend/objectapp/api_v1.py` | T5 | |
| `backend/objectapp/linkindex.py`, `rows.py` | T4 | |
| `backend/objectapp/graphdata.py`; `frontend/src/graph/GraphCanvas.tsx`, `useGraphData.ts` | T6 | |
| `backend/objectapp/typetemplates.py`, `frontend/src/types/templateQueries.fixture.json` | T7 | |
| `frontend/src/spaces/CreateSpaceDialog.tsx`, `StartingPointDialog.tsx`, `types/CreateTypeDialog.tsx` | T8 | |
| `frontend/src/object/PropertyPanel.tsx`, `ObjectView.tsx`, `views/properties.ts`, `views/table/tableConfig.ts` | T9 | |
| `frontend/src/properties/PropertySettings.tsx` | T10 | |
| `docs/behavior-catalog.md`, `docs/superpowers/plans/remaining-work.md`, `CONTINUE.md` | T11 | |

## Lanes

T1 runs first, alone. Then four tracks (counted from the Files lists; no file is in two tracks):

| Track | Tasks, in order | Waits for |
|---|---|---|
| B1 (back end: setup, Space, routes) | T2, T3, T5 | T5 waits for T4 (B2) |
| B2 (back end: index, gallery) | T4, T7 | T4 and T7 wait for T2 (B1): the fixture and `itops_types` |
| G (graph, both ends) | T6 | T6 waits for T4 (`edge_label`) |
| F (front end) | T8, T9, T10 | nothing: tests use T1's types and the mock API |

T11 integrates after all tracks. Then one whole-milestone review (correctness, file safety, fidelity to the design), one fix pass, the final gate (T11 step 3), and Gene's hands-on check.

## Our calls

1. **IT operations is a third choice**, listed between "Start with basic setup" and "Empty space", with icon `ph-hard-drives`; the value is `"itops"`. (design call 1; position and icon ours)
2. **Icons, colours, descriptions and folders** of the IT ops types, and the option colours, as the Contract. (design: left to the builder)
3. **Keys** of every property and counterpart (`runsOn`, `installedOn`, `documentedIn`, …). (ours)
4. **Single relations**: Operating system, Located at, Part of (both), and Software's Vendor hold one object; the rest are multi. A counterpart edit on a single source replaces its value. (ours)
5. **A counterpart is an option of the stored definition** (`options.counterpart`), next to `allowedTypes`, so the existing option shape checks and type saves carry it; the brief's "PropertyDefinition gains `counterpart`" is met through `options`. (ours)
6. **Counterpart rows per source, merged by key in the UI and in the virtual definition**: Script, Command and Runbook give one "Documented in" row on the page and one column in views. The `CounterpartRow` shape stays one per source, so an edit knows which property to write. (ours)
7. **When a counterpart row shows**: always (hidden while empty, like M22's work fields) for types the source names; only while it has a value for sources open to any type (Command, Runbook "Covers"). (ours)
8. **A stored key wins** over a counterpart key on the same type; a type save that would cause that for an explicit target is refused. (ours)
9. **`propertySyncing` and `counterpart` are exclusive**: the existing stored-both-sides relations keep working as they are. (ours)
10. **Only `entity` values count** for counterparts; body links and wikilinks in other front matter values stay plain backlinks. Templates never count. (ours)
11. **Counterparts are not exported**: the stored side is in the export, as backlinks aren't. (ours)
12. **No `/api/v1` counterpart write**: agents (and M30) write the stored side with the property routes; v1 reads carry counterparts. (ours)
13. **Edge labels** are the stored relation names (both directions joined by " · "), shown on the edges of the hovered or highlighted node only. (ours)
14. **The gallery's IT ops entries** are the 13 types that aren't already in the gallery (Person, Meeting and Project stay the basic ones; Source is not offered, since imports make it and its objects); an IT ops type added from the gallery also gets its default template, unlike the older entries. Each has one saved query (Contract list). (ours)
15. **Template sections** and template names (= the type name), as the Contract. (design: left to the builder)
16. **Seed tags** get deterministic colours by index; the Task statuses and priorities of the vocabulary are already the built-in Task's. (ours)
17. **Incident is a work type** (the M22 work fields and hidden `completed`, as Project), so incidents with a ticket appear in Tickets and Work; its own Cause (text) replaces the work-field Cause label on this type. (ours; the design says "plus the ticket fields")
18. **Incident Status categories**: Open and Mitigated are in progress, Resolved is done. (ours)
19. **Source in the starter** (Gene, 2026-11-09, design 5a): built by `source_type()` so M30 creates the same type in other spaces; icon `ph-file-text`, gray, no template (its body is the imported text). The **Sources** relation sits on the nine entity types only, hidden while empty; M30 adds it elsewhere when it distils into another type. (placement, icon, visibility ours)
20. **No Sources without a Source type** (fix pass): an IT ops type made from the gallery in a space with no Source type leaves its Sources relation out (it would be open to any type, so whatever it linked would show "Distilled into"); M30 adds it when it creates Source. (ours)

### Guesses (points the design leaves open that this plan had to settle; for Gene)

- **G1, Location's relation.** Section 1 gives Location "Part of (relation to Location)"; section 2's table puts "Location 'Located at' → Location" under "Contains". The plan keeps the property **Part of** (`partOf`) and gives it the counterpart **Contains**, so a Location's Contains row lists its hosts, networks and sub-locations.
- **G2, the status and priority vocabulary.** "Statuses: Back log, In progress, On hold, Complete; Not started, Done" and "Priorities: Low, Medium, High" name no property. The plan makes the first four the IT ops **Project's Status** options (with status categories so Work's Done still works: Complete is done), adds a **Priority** label (Low, Medium, High) to the IT ops Project, and reads "Not started, Done" as the built-in Task's statuses (nothing new).
- **G3, two "Resolved" fields on Incident.** The design gives Incident its own "Resolved" (date and time) and "the ticket fields", which include M22's "Resolved" (`deskResolved`). The plan names the ticket field **Desk resolved** on Incident only (like Desk status, Desk priority, Desk updated); the key is unchanged.
- **G4, "its properties shown" in the templates.** Read as: the type's own properties are always shown on a new object (visibility `alwaysShow`), and the template adds only the body sections.
