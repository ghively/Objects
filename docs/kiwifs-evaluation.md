# KiwiFS as a backend for Object: evaluation

Date: 2026-10-28. Source read: `github.com/kiwifs/kiwifs` at `aeb9a73` (release 0.19.81), shallow clone, static reading only (nothing run). Compared against Object `master` at `8d15e56`.

## What KiwiFS is

A single Go binary that serves a folder of Markdown files over REST, MCP, WebDAV, NFS, S3 and FUSE, with an embedded React/shadcn web UI. Files are the source of truth; everything else (search, links, metadata) is a rebuildable index in `.kiwi/state/search.db`. Roughly 83k lines of Go (non-test) and 88k lines of TypeScript UI. License: Business Source License 1.1 (free to self-host and modify; no commercial hosted service; each release becomes Apache 2.0 after four years).

It is a general "Markdown filesystem for agents and teams" (an Obsidian/Confluence substitute with an agent API), not an object/type system.

## How it works

Every write, from any protocol, goes through one write pipeline behind one mutex (`internal/pipeline/pipeline.go`):

1. validate (append-only guards, optional JSON Schema per folder)
2. format hooks (auto-numbering sequences)
3. atomic write: temp file, fsync, rename, dir sync (`internal/storage/local.go:255`)
4. `git add` + `git commit`, author taken from the `X-Actor` header (`internal/versioning/git.go`, shells out to the `git` CLI)
5. update SQLite FTS5 + metadata + optional vector index
6. update the wiki-link index (backlinks, typed links)
7. update workflow state
8. broadcast an SSE event
9. fire webhooks (HMAC-signed, retried)

Other pieces:

- **Concurrency:** optimistic, ETag = git blob hash; writes with a stale `If-Match` get 409.
- **External edits:** an fsnotify watcher replays out-of-band `.md` changes through the pipeline, so each external save becomes a git commit (`internal/watcher/watcher.go:288`).
- **Frontmatter edits:** `spliceFrontmatterField` replaces only the changed key's lines and keeps CRLF (`internal/markdown/frontmatter_splice.go`), falling back to re-encoding the whole block when it can't splice safely.
- **Search:** grep, then FTS5/BM25, then pluggable vectors (OpenAI, Ollama, ONNX local, Cohere; sqlite-vec, Qdrant, pgvector…), with hybrid fusion.
- **DQL:** a Dataview-style query language (`TABLE/LIST/COUNT … WHERE … SORT … GROUP BY`) compiled to SQLite over frontmatter (`internal/dataview`, about 8k lines).
- **MCP:** 77 `kiwi_*` tools (read/write/search/query, backlinks, graph walk/centrality, drafts, refactor plan/apply/revert, claims/leases, workflows, memory, views…).
- **Delete:** removes the file and commits the deletion. There is no trash; recovery is through git history.

## Overlap with what Object already has

Object's Python backend (about 21k lines in `backend/objectapp/`) already covers KiwiFS's core:

| Concern | Object today | KiwiFS |
|---|---|---|
| Atomic writes, CRLF/BOM kept | `textfile.py`, `Space._write` | `storage/local.go` (CRLF yes, BOM not checked) |
| Minimal-line frontmatter edits | `frontmatter.py` (`set_keys`, `rename_key`…) | `frontmatter_splice.go`, with a whole-block fallback |
| Full-text search | SQLite FTS5 in `.object-cache/` | SQLite FTS5 in `.kiwi/state/` |
| Links/backlinks | `linkindex.py`, `relink.py` | `internal/links` |
| File watcher | `watcher.py` (watchdog, debounced) | `internal/watcher` |
| Version history | `history.py`, snapshots outside the space | git commits inside the space |
| Delete/restore | `trash.py`, restorable trash | git delete commit |
| Multi-space | `spaces.py` | `internal/spaces` |
| Saved queries / views | `queries.py`, `collections.py` (Object's model) | DQL + saved views |

What KiwiFS has no equivalent for, and Object depends on: object types and type definitions, typed properties and their values, collections, tasks, daily notes, whiteboards, templates, reminders, block references, the Object UI. Those make up most of Object's code.

## Where it conflicts with Object's rules

1. **"Never write on read."** Opening a folder with KiwiFS runs `git init` if there is no `.git`, writes `.gitattributes`, and sets `core.autocrlf=false` in the repo config, even when `.git` already exists (`versioning/git.go:53-95`). It also creates `.kiwi/`. The watcher then commits every external edit. Pointed at an existing folder, or at Gene's export copy, it changes that folder on open.
2. **Deletes go to the trash and can be restored.** KiwiFS has no trash, only git history.
3. **Object's own model defines the data model.** KiwiFS's model is "pages + frontmatter + folders". Adopting it as the backend would mean re-expressing Object's types and properties on top of it, which the ground rules forbid.
4. **Out of scope by the spec:** vector embeddings through cloud providers, webhooks, OIDC/auth, share links and publishing, S3/NFS, importers from Notion/Postgres/etc. (network integrations, accounts, sharing).
5. **Stack:** Go plus the `git` CLI, against Object's Python + `uv`. Replacing the backend means rewriting about 21k lines of tested Python in Go, or running two servers.
6. **License:** BSL 1.1 is fine for internal use, but copied code keeps its license notice. Porting ideas is free; copying code is not unencumbered.

## Verdict

**Not as a backend replacement.** Most of KiwiFS duplicates what Object already does, it lacks the object model that makes up most of Object, and its default behaviour breaks the never-write-on-read and trash rules.

**Yes as a source of ideas**, ported into Object's Python as clean-room features, in this order of value:

| Feature | Value to Object | Fit with the spec | Size |
|---|---|---|---|
| **MCP server** over Object's API (read/search/query objects, set properties, create objects, backlinks) | The "in-app Claude Code agent comes later" item needs exactly this; KiwiFS's tool set is a good checklist | In scope once the agent milestone starts | Medium: a thin FastMCP layer on existing `Space` methods |
| **ETag / If-Match on writes** | Stops the UI and an agent (or an external editor) from overwriting each other | Fits; no on-disk change | Small |
| **Opt-in git history** (commit per save, blame, diff) as an alternative to `history.py` snapshots | Line-level diff and blame, and audit for agent edits | Only opt-in, only when the folder is already a repo; never `git init` on open | Medium |
| **Local semantic search** (ONNX MiniLM + sqlite-vec, in the cache folder) | "Find related" and fuzzy recall | Borderline: counts as AI; local only | Medium |
| **Agent-safe edits:** drafts with diff/merge, refactor plan → apply → revert | Lets an agent propose changes that Gene reviews | Agent milestone | Medium-large |
| **Content health:** broken links, orphans, stale pages | Cheap with `linkindex.py` already there | Not an Object feature; would be an addition | Small |
| WebDAV mount | Edit the space as a mapped drive | Weak: the folder is already local | Skip |
| NFS/S3/FUSE, webhooks, OIDC, share links, cloud embedders, 19 importers | none locally | Out of scope | Skip |

## Unknowns

- Whether KiwiFS preserves a UTF-8 BOM on its frontmatter splice path (not checked).
- Runtime behaviour on Windows (nothing was run; the Windows `procattr` file suggests it is supported).
- How well DQL would map onto Object's query filters (not compared in depth; Object's query model is its own, so DQL would at most be an extra power-user surface).
