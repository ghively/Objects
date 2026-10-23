# Capacities 1.71.32: reverse-engineering findings

Goal: understand Capacities well enough to build a **private, offline, Markdown-backed** equivalent.
Method: static inspection only. The installer was never run and no network traffic was captured.

## Target identity

| Item | Value |
|---|---|
| Installer | `Capacities-1.71.32.exe`, 274,475,680 bytes |
| SHA-256 | `10c98c6843f8a9bef00a7fbe280b948efd7dcbd5056cd58941bb2dae89f01fd0` |
| Signature | Valid Authenticode, `CN=Capacities Labs GmbH` (DE) |
| Format | electron-builder NSIS; two embedded 7z payloads (ARM64 at offset 227021, second build at 136357344) |
| `app.asar` SHA-256 | `10496fd28a9f59eaec3f04cd33597879d7f6ab82147fcfc9e363b89bdefc7484` (from the ARM64 payload) |
| REA Evidence | `ev_bfabf1bd2169fc04db06e518c302c1f06f87c96c04238cac9ee54b43ff1a30ca` (analyze_javascript_application, 337 JS files parsed, 0 parse failures) |
| Auto-update | `electron-updater` → S3 bucket `capacities-desktop-app` at `2vks4.upcloudobjects.com` |

Working files (scratch, not in this repo): extracted app, unpacked ASAR and TypeScript recovered from source maps under the session scratchpad.

## Confidence key

- **Observed**: read directly from the shipped files.
- **Inferred**: my reading of what the observed code means.
- **Unknown**: not established by static analysis.

## 1. Architecture (observed)

- **Stack:** Electron shell + Vue 3 SPA (vue-router, vue-i18n, Tailwind) built with Vite. The same codebase also ships iOS and Android through Capacitor.
- **Renderer is bundled locally.** The main window loads `getBaseUrl() + '/index.html'`, served from `dist/` through a custom `app://` protocol (`src/electron/electron.ts:482`, `:623`). The UI itself does not come from the web.
- **Backend is the source of truth.** The renderer talks to `api.capacities.io` (auth on `/user/*`, content on `/content/*`, everything else on `/resources/*`). Auth uses cookies on `/user/login` and `PATCH /content/sync` (`general.model.ts:16-40`).
- **Local data is a cache.** SQLite-WASM (`@sqlite.org/sqlite-wasm` + `sqlocal`, in web workers) holds a copy of synced objects for fast queries and offline reading. **Inferred:** offline edits are queued and pushed through `/content/sync` and `/content/changes-bulk`; global/component sync states are modelled in `general.model.ts:462-489`.
- **Main ↔ renderer bridge:** one `contextBridge` API, `window.electronAPI`, with generic `renderer-to-main-request` / `main-to-render-request` IPC plus streamed media-open and export channels (`src/electron/preload.cts`).
- **Local REST API:** Express on `localhost` with a bearer token and 100 requests/minute: `GET /spaces`, `GET /space-info`, `POST /search`, `POST /save-weblink`, `POST /save-to-daily-note`, `POST /save-task` (`localApiDefinition.ts`). It proxies into the renderer, so it is not a separate data store.
- **Export** is server-generated (`/resources/utils/export`, `exportPdf`, `exportTypesetPdf`). The Electron side only streams the result to a chosen folder for scheduled backups (`electron-export.ts`).
- **Third-party services:** Sentry, Unsplash (proxied through `portal.capacities.io`), OpenAI and other AI providers (`ai`, `openai`, BYO-key config), Readwise, Kindle, CalDAV calendar, Telegram/WhatsApp/email/Twitter ingest, RevenueCat and subscriptions, and push notifications.

## 2. Local cache schema (observed, `dist/assets/worker-casual-*.js`)

```sql
components     (id PK, spaceId, structureId, title, createdAt, lastUpdated,
                deleteRequested, isError, dateResolution, startTime, endTime,
                component TEXT /* full JSON object */, metadata TEXT /* JSON */)
media_content  (id PK, spaceId, structureId, lastUpdated, data)
notifications  (id PK, spaceId, type, meta, fireAt, state, seenAt, readAt, actedAt, archivedAt, lastUpdated, createdAt, expiresAt)
kvs            (key PK, value)
_meta          (key PK, value)
notes_fts      USING fts5(text, spaceId, id, structureId, field, lastUpdated, metadata; tokenize='unicode61')
```

Every object is stored as one JSON document, with a few denormalised columns for querying and an FTS5 table for full-text search. That pattern carries over directly as the derived index in a Markdown rebuild.

## 3. Data model (observed, `shared-logic/models/*.ts`)

Everything is a **Component** with the same envelope:

```
id, type, structureId, createdAt, lastUpdated, deleteRequested,
properties: { title, icon, description, tags, aliases, ...custom },
data:       { blocks: { [propertyId]: Block[] }, ...view state },
linkNodes:  LinkNode[]          // typed edges
databases:  LinkNodeUp[]        // which collections it belongs to
```

**Component types (`cTypes`):** RootSpace, User, UserPersonal, RootStructure (object type), RootDatabase (collection), RootQuery (saved query), RootPage, RootEntity, RootBlocksTemplate, RootTag, RootDailyNote, RootTask, RootSimpleTable, RootWhiteboard, RootAIChat, UtilDate, and Media{Image, PDF, Audio, Video, WebResource, File, Tweet}.

**Object types = `RootStructure`.** Each holds `propertyDefinitions[]`, view definitions (inline / smallCard / wideCard / embed / page), a layout (`profile | indexCard | encyclopedia`) and calendar options. A user-defined "Book" or "Person" type is a RootStructure. Objects point to their type through `structureId`.

**Collections = `RootDatabase`.** A named set of objects of one or more structures (`structureIds`), with views, templates and pinned items. An object can belong to several collections.

**Property types:** `text, textBlock, simpleTableBlock, number, boolean, url, blocks, datetime, datetimeSimple, entity (relation), label (select/status)`, plus system properties (title, icon, description, aliases, createdAt, lastUpdated, tags, type, collections, backlinks). Values are always `{ val: ... }`; relations are `{ val: LinkNodeDown[] }`, labels are arrays of label ids.

**Blocks (content tree):** `TextBlock` (rich `tokens[]`, heading level H1–H4/small, list bullet/alpha/numeric/roman, todo, toggle, quote, colour, nested `blocks`), `CodeBlock` (lang, text, markdown/mermaid preview), `MathBlock` (KaTeX), `HorizontalLineBlock`, `EntityBlock` (embedded or linked object, inline data view), `GroupBlock`, `GridBlock` (columns), `SimpleTableBlock`/`SimpleTableColumn`.

**Links:** `LinkNodeDown` (type `Dependency`: this object references another) and `LinkNodeUp` (type `Database`: membership in a collection). Backlinks are computed from incoming Dependency links. Block-level references use `{type:'block', bId}`.

**Unknown:** the exact `Token` shape inside `TextBlock.tokens` (`tokens.model.ts` is not in the main-process source map). It is recoverable from the renderer bundle if needed. You don't need it for a Markdown rebuild, because inline formatting becomes Markdown syntax.

## 4. What makes it cloud-dependent (observed)

| Feature | Dependency | Offline replacement |
|---|---|---|
| Storage and sync | `api.capacities.io/content/*` | Files on disk; optional git/Syncthing |
| Login, sessions, 2FA | `/user/*` | None needed (single user) |
| Export (MD/PDF) | Server-side `/resources/utils/export*` | Files are already Markdown; Pandoc for PDF |
| Media upload | `/resources/multipart/*`, S3 | `attachments/` folder |
| Weblink capture | Server metadata fetch | Local fetch + `@mozilla/readability` (already used client-side) |
| AI chat/autofill | Capacities AI / OpenAI keys | Local model (Ollama/OpenVINO) or none |
| Unsplash covers | `portal.capacities.io` proxy | Local images |
| Readwise, Kindle, calendar, messaging ingest | Server-side integrations | Out of scope or local importers |
| Telemetry | Sentry | Remove |

## 5. Proposed Markdown mapping (design choice, not observed)

```
vault/
  .capacities-lite/          # derived, rebuildable: index.sqlite (FTS5), cache
  _types/book.yaml           # RootStructure: name, icon, propertyDefinitions, views
  _collections/reading.yaml  # RootDatabase: name, types, saved view config
  _queries/*.yaml            # RootQuery
  Book/Atomic Habits.md      # object; folder = type
  Person/James Clear.md
  Daily/2026-10-23.md        # RootDailyNote
  Tag/productivity.md        # RootTag (optional page body)
  attachments/<id>.<ext>     # Media*
```

Object file:

```markdown
---
id: 3f1c…            # stable UUID, so renames don't break links
type: book
title: Atomic Habits
icon: "📗"
created: 2026-10-23T16:20:00Z
updated: 2026-10-23T16:41:00Z
collections: [reading]
tags: [productivity, habits]
author: "[[James Clear]]"    # entity property → wikilink
status: reading              # label property → label id/name
rating: 4                    # number
---

Body blocks as Markdown: headings, lists, `- [ ]` todos, > quotes,
```code fences```, $$math$$, | tables |, ![[embedded object]].
Block refs: [[Atomic Habits#^blockid]].
```

Mapping rules:

- Simple properties go in YAML frontmatter; relations become `[[wikilinks]]` (resolved by `id`, falling back to title).
- `blocks` and `textBlock` properties other than the main body become `## Property name` sections, or sidecar notes.
- Toggles, grids, groups and colours have no clean Markdown form. Use HTML comments or `:::` fences, or drop them. Decide per feature.
- Backlinks, the graph, collections views and full-text search come from the derived SQLite index, rebuilt by a file watcher. The files stay authoritative.

## 6. Capacities' own Markdown export (observed, `Capacities (2026-10-23 16-27-39).zip`, CPI space)

100 files: 98 `.md`, 2 `.csv`. Layout is `<Space>/<TypeFolder>/<Title>.md`:

```
CPI/App  DailyNotes  Files  Meetings  Other  Pages  People  Projects  Prompts  Servers  Tasks  Weblinks  Workstations
```

Each file is YAML frontmatter followed by `# Title` and the body:

```yaml
---
type: 'Task'            # object type display name, quoted
title: Standalone GUI
tags: []                # tag *names*, e.g. [AI, LLM]
status: Not Started     # label property → label name
date: null              # unset properties are written as null, not omitted
priority: null
completed: null         # or ISO timestamp
---
# Standalone GUI
```

What the export tells us:

- **Property keys are camelCased property names** (`peopleInvolved`, `timeFrame`, `previewImage`). A custom property named "Type" collides with the system key and is exported as `type_`.
- **No object IDs.** Links in bodies are `[[Title]]` (43 in this space), so titles are the only join key. Duplicate titles (several `Untitled.md`) are ambiguous. The importer must assign UUIDs and resolve links by folder + title.
- **Date ranges** are a single string: `timeFrame: 2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z`.
- **Type-specific system fields:** Weblink has `url, domain, iframeUrl, previewImage`; File/Image have `mimeType, fileSize, width, height, source`; DailyNote has `date, reviewed`; Page has `aliases, icon, coverImage`. `icon` is an Iconify id (e.g. `vscode-icons-file-type-excel`).
- **Tables** become GFM pipe tables; a few table objects become `.csv`.
- **Lost in export:** binary attachments (the `.xlsx` File object is metadata only), the object-type definitions (property types, label options and colours, views), collections membership in most cases, block layout (grids, toggles, colours) and backlinks. **Inferred:** in the new app, type schemas must be seeded by hand or inferred from frontmatter keys.
- **Sensitive content:** this space contains internal hostnames, IPs and at least one page titled as holding an API key. Keep the vault local and out of any synced or committed location, and consider encryption at rest.

## 7. UI look and organisation (observed from bundle; visuals still need screenshots)

**Design tokens** (`dist/index*.css`, Tailwind v4):

| Token | Value |
|---|---|
| Font | Inter (sans), Georgia (serif option), Courier New (mono) |
| Base size | 15px (`--font-size-base .9375rem`), small 13.5px, xs 12px, xxs 11px |
| Palette | Tailwind gray/neutral; dark mode via `.dark` class |
| Radii | 2 / 4 / 6 / 8 / 12 / 16 / 24 px; icon boxes use a 32% squircle |
| Shadows | Very soft multi-layer (alpha 1–13%); "glass" shadows for floating panels |
| Icons | Iconify (Phosphor `ph` set bundled) and emoji |

**App shell** (from `RootSpace.model.ts`, `component.model.ts`, `dataView.model.ts`):

- **Left sidebar per space:** fixed sections `objects` (types and collections) and `pinned`; the dashboard sections are `calendar` (daily notes), `explore` (AI chats), `search`, `shared`, `graph`, `allNotes`, `firstSteps`.
- **Tabs:** each tab has breadcrumbs (a navigation trail of object ids), can be pinned or persistent, and remembers daily-notes view (`day | week | rolling | month`).
- **Side panels:** up to three resizable areas (`area1–3`) beside the main view, holding objects, AI chats, queries or related content.
- **Object page:** cover image, icon, title, property section (hideable), body blocks, a right "object sidebar" with `outline | objects | stats`, and a references section with tabs `all | backlinks | related | mentions | relatedTags`. Layout variants per type are `profile | indexCard | encyclopedia`, plus wide mode.
- **How objects render elsewhere:** `inline` (link chip), `smallCard`, `wideCard`, `embed`, `page`.
- **Collection/query views:** `list | grid | wall | table | embed | kanban`, with filter groups, group-by and sort.
- **Global UI:** command palette, app menu, settings modal, emoji/Iconify icon picker, multi-space picker, CodeMirror code blocks with Mermaid preview, PDF viewer, Pixi.js whiteboard.

Static code gives structure and tokens, not spacing details or interaction feel. Screenshots of the real app are the reference for those.

## 8. Notes on approach

- The main-process source map ships the original TypeScript (`sourcesContent`). I used it **to understand the model only**. Capacities is proprietary, and its licence very likely restricts copying and reverse engineering. Build the replacement **clean-room**: treat this document as the spec and don't copy their source, styles or assets into your code.
- **Migration path:** check what Capacities' own export ZIP actually produces (Markdown and frontmatter conventions). A sample export from your account is the cheapest way to design the importer. Format: **unknown** until we see one.
- Prior art worth a look before building: Obsidian with Bases/Dataview gets close to "typed objects in Markdown" and runs offline. It's worth comparing before committing to a full custom app.
