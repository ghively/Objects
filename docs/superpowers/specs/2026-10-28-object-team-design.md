# Object Team: next-version design

Date: 2026-10-28. Owner: Gene Hively. Status: **approved by Gene on 2026-10-28 and parked.** Nothing here is to be planned or built until Gene decides to expand Object to the team. When he does, start with a Phase 1 plan (section 9).

This is the design for the **next version** of Object. The current version (M1–M8, the local single-user app in `2026-10-23-object-design.md`) is finished first: the 2026-10-28 audit fixes and Gene's hand checks come before any of this is built. This document reopens four things that spec put out of scope: accounts, sync, sharing and AI-related features.

Calls marked *(builder's call)* or *(Claude's call)* were not decided by Gene; everything else was.

## 1. Intent

Object becomes a **team knowledge space**. A server on CPI's network holds one shared vault; teammates reach it from the web client in a browser or from the desktop app, which keeps working offline and syncs later. Each teammate also points their own Claude session at the server over MCP, and the server makes the vault quick and token-cheap for those agents to find, read and safely edit.

Why: Gene wants a shared, Capacities-style space for the team that agents can use as well as people, without people (or agents) overwriting each other's edits. KiwiFS (`github.com/kiwifs/kiwifs`, evaluated in `docs/kiwifs-evaluation.md`) is the reference for the agent-facing and server-side features; Capacities stays the reference for the app itself. Capacities has no answer for multi-user conflicts (it is single-user), so the conflict model is new here.

## 2. Goals

1. **One shared space on a server.** Everyone signed in can see and edit everything.
2. **Three clients on one vault:** the web client (live against the server), the desktop app (offline-first with sync), and agents over MCP.
3. **No silent loss of anyone's edit.** Concurrent edits merge; real clashes are kept and flagged for a person.
4. **Attribution.** Every change records who made it (and whether through an agent), with full history.
5. **An agent layer** that makes the vault cheap to search and read, and safe to write, for users' own Claude sessions.
6. **Outside connections:** webhooks and a WebDAV mapped drive.

## 3. Non-goals and anti-goals

**Non-goals (not in this version):**
- Live co-editing or visible cursors. Gene explicitly doesn't want them.
- Per-user permissions or read-only users. Beyond each person's private user space (section 5.4), everything is one shared space.
- Any AI model running on the server. Users bring their own Claude sessions.
- Cloud embedding providers. Semantic search runs on the server.
- NFS, S3 and FUSE access. Deferred, with room left in the design for them.
- Mobile, internet-facing hosting, billing, telemetry.

**Anti-goals (it fails even if it "works"):**
- Someone's edit disappears without trace, from sync, an agent, the web client or the drive.
- Conflict markers (`<<<<<<<`) or merge metadata written into the user's `.md` files.
- Any write path (agent, drive, sync, import) that bypasses attribution, history or the merge where one applies.
- The plain `.md` files stop being the single source of truth (for example a CRDT sidecar the files can't be rebuilt without).
- The server changes the vault just by opening or indexing it.

## 4. Constraints

- **Grow Object's Python backend** (`backend/objectapp/`) into the server. Don't fork KiwiFS. Everything built and tested in M1–M8 carries over: the object model, types, properties, collections, tasks, whiteboards, trash and file handling.
- **KiwiFS is a reference only.** Read it for behaviour and tool design. Don't copy its code (it is under BSL 1.1).
- **Object's existing file rules still hold on the server and the desktop:**
  - Never write on read.
  - A property edit changes only its own lines.
  - Deletes go to the trash and can be restored.
  - CRLF and BOM are preserved.
  - Writes are atomic.
- **Capacities stays the bar for the app.** Wherever Capacities has an equivalent (sync status, account menus, settings), match its labels and behaviour. New UI that Capacities lacks (needs review, drafts, claims) follows Capacities' visual language.
- **The plain `.md` files are the single source of truth.** Every index (search, vectors, links, graph) is derived and rebuildable, and lives in a cache folder.
- **Deployment is a Docker container** (Linux), with the vault on a mounted volume so the files and history survive container upgrades.
- **It runs on CPI's own network.** No CPI data leaves it: semantic search uses a local embedding model running on CPU in the container.
- **Credentials never go in committed files.** Users' MCP tokens live in their local Claude settings (`settings.local.json` or the equivalent).
- **Repo rules from `CLAUDE.md` still apply:**
  - Fixtures are synthetic; no real CPI data in the repo.
  - Each phase is built with TDD, then gets one review at the end.
  - Gene checks each phase hands-on.

## 5. The pieces

### 5.1 Server

The Python backend runs in a container. It:
- serves the web client (the existing React front end);
- handles accounts and sign-in;
- runs the sync endpoint for desktop apps;
- hosts the MCP endpoint (HTTP) for agents;
- runs the WebDAV drive and the webhooks.

It holds the canonical vault, its git history, and the derived indexes. Today it binds only to 127.0.0.1; it has to listen on the network instead. *(Builder's call: how TLS is done, a reverse proxy or the server itself. HTTPS is required before passwords or tokens cross the network.)*

### 5.2 Desktop app

Today's app (pywebview window plus the local Python backend), running against a **local copy** of the shared vault, with a sync engine. It works fully offline. When it can reach the server it pushes its changes and pulls everyone else's. Each change it pushes carries the version it was based on. It shows sync state and the "needs review" list. *(Claude's call: the desktop can still open a purely local, unsynced space as it does today.)*

### 5.3 Web client

The same React front end, served by the server and working live against it. Its saves carry the version they were based on, like every other write.

### 5.4 User spaces and per-user state

**Each person has a private user space alongside the shared team space.** Gene's rule: it is private **to other users, not to the server**.
- **Other users can't see it,** in the app or through their agents' MCP tools.
- **The server reads all of it** for indexing, the memory report and keeping team objects current.
- **A user's own agent** sees that user's space plus the team space.
- **A team object can still show** that it has unconsolidated notes pointing at it, with whose and when, but not their content. *(Claude's call: how much the flag reveals.)*
- **It is not encrypted at rest.** Anyone with access to the server's disk can read it. *(Claude's call: no admin screen for reading other users' spaces.)*
- **Moving an object** from a user space into the team space is an explicit action, recorded in history. *(Claude's call.)*

Gene decided these are each person's own, not the team's:
- **Personalisation:** pins, sidebar sections and order, All-notes and other view layouts, change-type preferences. Today these live in `.capacities/ui.json` inside the space. In a team vault they become per-user state on the server, synced to that user's desktop, and never merged as a team change.
- **Daily notes:** one per person per day.
- **Reminders:** each reminder is **personal** (fires only for the person who set it) or **team** (fires for everyone). Personal is the default. *(Claude's call: which option is the default.)*

### 5.5 Accounts

- Accounts exist for **attribution**, not access control. Every signed-in user can read and edit everything.
- **Gene administers users on the server.** *(Claude's call:)*
  - In Phase 1 that is a command-line tool in the container (add, disable and reset users; set up a team vault). An admin screen can come later.
  - Webhook settings live in the server's config file.
  - Windows/AD sign-in comes later.
- **Tokens:** each user can create personal API tokens for their MCP connection, and revoke them. Agent writes are attributed as "<user> (via agent)".

## 6. Sync, history and conflicts

### 6.1 History

- **Accepted changes become git commits in the server's vault**, authored by the user (marked "via agent" where it applies). *(Claude's call on grouping:)*
  - Autosaves by one user to one object are grouped into one commit per quiet window, like M8's 5-minute history grouping.
  - A multi-file operation (a rename that relinks backlinks, merging objects, a refactor, an import) is one commit.
  - Version stamps are per save (a content hash), independent of commits, so the merge never waits for a commit.
  - A desktop that edited a file offline, which a multi-file operation also touched, merges that file like any other.
- **Git gives full history, diff and blame** per object, and replaces M8's snapshot history (`history.py`) for team spaces. *(Claude's call.)*
- **On first open, the server initialises git only in a vault it is told is a team vault.** That is an explicit setup step, not a side effect of opening a folder.

### 6.2 Version stamps

Every object has a version (for example the hash of its committed content). Reads return it, and every write (web, desktop sync, MCP) sends back the version it started from.

### 6.3 The merge

When a write's base version isn't the current one, the server does a three-way merge between the base, the current version and the incoming one:

| What changed | Result |
|---|---|
| Frontmatter / properties | Merged **key by key**. Different keys changed on each side: both kept, silently. |
| Body text | Merged **like git, by line or paragraph**. Changes to different parts: both kept, silently. |
| Same key or same paragraph changed differently on both sides | **A real clash.** Every part that merges cleanly is applied. Only the clashing key or paragraph keeps the server's current side in the `.md` file. The incoming side of each clashing part goes into a conflict record **outside the `.md` file**, one entry per clashing hunk. The object is flagged **"needs review"**: the people involved see each clash with both sides, their authors and the base, and pick or edit the result. A long offline session is never held back by one clash, nothing is lost, and no conflict markers go into the file. *(Claude's call.)* |
| Edit on one side, delete on the other | The object is kept (restored from trash if needed) with the edit, and flagged "needs review". *(Claude's call.)* |
| Both sides created an object at the same path | Both kept: the second is saved under a new path, and both are flagged. *(Builder's call: exact naming, following Object's existing path rules.)* |

**Other definition files** under `.capacities/` also go through the merge field by field, with clashes flagged the same way. These are the type definitions, saved queries, collections and whiteboards (JSON). Binary media merges as last-write-wins, with the earlier version always kept in history.

*(Builder's call: the sync protocol and transport, for example a change feed plus batched pushes, or git itself. It must satisfy 6.2 and 6.3 and must not put merge state into the user's files.)*

### 6.4 Team state outside the vault

*(Claude's call.)* State that isn't content, and can't be rebuilt from the `.md` files, lives in a server store outside the vault, never in git and never in the repo. It is covered by the backup:
- accounts, password hashes and tokens;
- webhook settings;
- conflict records, drafts, and claims and leases.

The sync API sends conflict records and claims down to desktops, so they show offline (read-only). Resolving a clash or claiming a task needs the server. Workflow stages use Object's existing task status property and options, with no new schema.

### 6.5 Writes without a base version

The WebDAV drive and out-of-band file edits on the server can't say what version they started from. They are accepted as **last write wins**, committed and attributed, so the overwritten version is always recoverable from history. WebDAV locking should be honoured to reduce clobbering. These writes don't produce "needs review" flags.

## 7. Agent layer (MCP)

The server exposes an **MCP endpoint over HTTP**. Users connect their own Claude sessions with a personal token. **The tools act through the same services as the app**, so they respect the object model, the merge, history, trash and attribution. The tool set follows KiwiFS's, expressed in Object's model. Its tools fall into these groups:

**Find**
- Hybrid search: keyword (the existing FTS5 index) plus semantic (local embeddings), with results fused.
- Similar objects.
- Structured queries using Object's own filter model (type, property values, tags, the same filters as collections and queries).
- Graph:
  - backlinks;
  - neighbours N hops out;
  - the path between two objects;
  - central and clustered objects.

**Read cheaply (token savers)**
- *Peek:* title, type, properties, heading outline and size, with no body.
- *Section:* one heading or block of an object.
- *Context pack:* the most relevant snippets for a question, cut to a token budget.
- *Changes since:* what changed since a version or time, with authors.
- *Schema:* the space's types and their properties.
- *Tree / list:* paginated.

**Write safely**
- Create objects.
- Set properties.
- Append to, or replace, a section.
- Rename, move and delete (to the trash).

Every write sends a base version and goes through the merge (section 6). Agent writes are attributed "<user> (via agent)".

**Drafts**
An agent works in a private draft of one or more objects. A person reviews the diff in the app and merges it (through the same merge) or discards it. This is "propose, don't touch."

**Task claims and workflows**
- An agent or person can **claim** a task object, with a lease that expires, so two agents don't work the same task.
- **Workflow boards** move objects through defined stages, built on Object's existing tasks and status properties.

**Agent memory** (modelled on KiwiFS's episodic/semantic split; Gene approved this shape)
- **Why:** besides recall across sessions, memory keeps the team's pages current. Every agent action is recorded and tied to the objects it touched, so the team can see where agents have learned something that a page doesn't say yet.
- **Episodes:** one new built-in type, **Episode**, the only invented schema here. Each is one agent session's notes and lives in the user's own space, like daily notes. An episode records:
  - its author ("<user> via agent") and when;
  - what it did and found;
  - links to every object it read or changed, which the server adds from the agent's own MCP calls.
- **Lasting memory is the team's ordinary objects,** of whatever types the space already has. They gain optional memory properties:
  - status (active, contested, superseded or stale);
  - valid from / valid until;
  - expires / review after;
  - contradicts;
  - built from (the episodes it was consolidated from).
- **Consolidation** is done by the user's own Claude session: it folds episodes into the team objects and records "built from". The server never runs a model.
- **Tools:**
  - **remember:** write to the current episode;
  - **forget:** mark superseded, never delete;
  - **memory report:** episodes not yet consolidated, expired or contested memories, and objects with unconsolidated episodes pointing at them ("may be out of date");
  - **brief / context:** a new session's starting pack.
- **Contradictions:** a note that contradicts an object marks that object *contested*, visibly, instead of silently overwriting it.
- *(Claude's call: the exact property names and their option labels, following Capacities' property style.)*

**Quizzes and evals**
- Generate questions from the space.
- Check answers against it.
- Report how well the vault answers what it should.

*(Claude's call:)* the user's own Claude session generates the questions and judges free-text answers. The server only stores quiz sets, checks exact-match answers mechanically and keeps the scores. No model runs on the server.

**Refactors**
Plan a bulk change, preview it, apply it as one change, and roll it back. Examples:
- rename a property;
- re-type objects;
- move or split objects;
- rewrite links.

**Whiteboards**
Agents can list, read and write Object's whiteboards.

**Importers**
- Bring outside content in as Object objects with types and properties: Notion, Obsidian, CSV, Markdown folders, databases.
- *(Claude's guess, for Gene to confirm when that phase is planned: this is also how `C:\Git\wiki` and a Capacities export come in later. That migration stays a separate project.)*

**Health**
- broken links;
- orphans;
- stale objects;
- the "needs review" list.

*(Builder's call: the exact tool names and how many there are. KiwiFS's `kiwi_*` list is the checklist, not the spec. Tools KiwiFS has that aren't listed here are out.)*

## 8. Outside connections

- **Webhooks.** These are signed POSTs to configured URLs on events: object created, updated or deleted; needs-review raised or resolved; task claimed or released; draft merged. They retry with backoff. Targets in mind: a Teams channel and Gene's n8n workflows.
- **WebDAV.** The vault appears as a Windows mapped drive. Users sign in with their account or a token, and writes are attributed. It is last-write-wins (section 6.4) and honours locks.
- **NFS, S3, FUSE: deferred.** Every access path must go through one write layer (attribution, history, index, webhooks), so adding one later touches nothing else.

## 9. Phases

Each phase is usable on its own, gets its own plan (in the M7/M8 plan format) and is hand-checked by Gene before the next one is relied on.

1. **Team server:**
   - the container;
   - accounts and sign-in;
   - git history and attribution;
   - version stamps on every write;
   - the server-side merge;
   - the web client working against the server.
2. **Desktop sync:**
   - the local copy;
   - the sync engine;
   - offline work;
   - the needs-review UI.
3. **Agent read layer:**
   - the MCP endpoint and tokens;
   - search (hybrid, semantic, similar);
   - queries and the graph;
   - the token savers.
4. **Agent write layer:**
   - writes through the merge;
   - drafts;
   - claims and workflows;
   - memory;
   - refactors;
   - whiteboards.
5. **Connections and extras:**
   - webhooks and WebDAV;
   - importers;
   - quizzes/evals;
   - health checks.

## 10. Left to the builder

- **Sync protocol and transport,** within section 6.
- **TLS setup and the container layout:** base image, volumes, the config file.
- **The embedding model and vector store,** as long as they are local, run on CPU and keep the index in the cache folder. *(KiwiFS uses MiniLM through ONNX with sqlite-vec.)*
- **MCP tool names and shapes.**
- **Password hashing and token formats,** using standard libraries.
- **How the needs-review screen looks,** in Capacities' visual language.
- **The expected scale.** *(Claude's guess: a team of up to about 20 people and a vault of tens of thousands of objects. Design for that, not for hundreds of users.)*
