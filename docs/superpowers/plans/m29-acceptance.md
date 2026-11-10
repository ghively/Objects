# M29 acceptance: synced facts and type suggestion

Status (2026-11-10): built 2026-11-10 on parallel lanes by file ownership (T1-T11 merged up to `8ca54c02`; T12, the settings for the synced mark, name patterns and the sync token, on its own lane), integrated in T13; the acceptance script passes. The whole-milestone review, its fix pass and the full gate come next. Gene's hand checks below are unticked.

Plan: `2026-11-09-m29-synced-facts-and-type-suggestion.md`. Design: `specs/2026-11-09-it-ops-type-model-design.md`, sections 3 (synced facts) and 4 (type suggestion and templates).

## How to run the acceptance script

```
uv run python scripts/m29_acceptance.py [SPACE] [--keep]
```

(In a container where `uv run` can't sync, the same with the venv's Python: `PYTHONPATH=scripts:backend .venv/bin/python scripts/m29_acceptance.py`. Check 6 starts `uv run --directory <repo> objectapp-mcp`, as Claude Code does; where `uv run` can't sync, put a `uv` shim first on `PATH` that runs `objectapp.mcp_server.main` from the venv with the repo's `backend` first.)

SPACE defaults to `backend/tests/fixtures/space-synced` and is never touched: the script copies it to a temporary folder, commits the copy to a throw-away git repo (again after one open), points `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `OBJECT_CLOCK_FILE` (2026-11-09T10:00:00Z) at temporary paths outside it and serves the app on a free `127.0.0.1` port. No agent runs, so no `claude` (real or fake) is started. It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any failure. The checks:

1. Reads write nothing: `GET /api/space` (the app serves the types there; it has no `GET /api/types`), `GET /api/types/host/templates`, `POST /api/rows {"typeIds": ["host"]}` and `GET /api/object` of every Host leave `git status` clean, and there is no `.object/synced/`.
2. A `sync` token made through `POST /api/integrations/tokens {"scope": "sync"}` (`GET /api/v1/whoami` answers `scope: "sync"`); `POST /api/v1/synced/host` with the fixture's seven items answers, in item order, updated (APP01 by title, never `Pages/APP01.md`), updated (Print box by its alias `PRN-TEST-01`), updated (APP01 by `fqdn`, merged with the first), ambiguous (both WEB01s, `2 Hosts have the title "WEB01".`), notFound (Gateway, excluded from AI), notFound (the Host template) and invalid (`diskFree: "lots"`, "Expected a number."); the store holds APP01 `{diskFree: 12, patchState: "Current"}` and Print box.
3. `git status` after the sync lists only `Hosts/Print box.md` (one added `id` line, by `hunk_keys`) and `.object/synced/host.json`; a second sync (SRV-02's Last boot and Patch state, Print box's Disk free) changes only `.object/synced/host.json`; `SRV-02.md` still has CRLF and the BOM.
4. `GET /api/object` of SRV-02 shows the store's `lastBoot`, not the file's hand-typed 2020 value (which stays in `frontmatter`); `PUT /api/object/properties {diskFree}` is 422 `"Disk free" is filled by Inventory script and can't be edited.` and APP01's file is unchanged.
5. The sync token on `POST /api/v1/object/properties` is 403 `This token can only write synced facts.`
6. Over a stdio `objectapp-mcp` session with the sync token: the tool list has every read tool and `sync_facts`, and no other write tool; `sync_facts("Host", …)` sets APP01's Disk free to 41.5.
7. The clock moves to 2026-11-17 (8 days on): APP01's row `syncedAt` is unchanged and more than 7 days old (the UI marks it Stale).
8. `PUT /api/types/host` with `namePatterns: ["{foo}"]` is 422 (`"{foo}" isn't a name pattern. Use *, ?, #, @ or one of {ip}, {cidr}, {fqdn}, {version}.`); the type file is unchanged.
9. `git status` lists nothing else (only `.object/synced/host.json` since the second sync); the state dir holds `api-tokens.json` and `api-activity.jsonl` only, with one `sync` activity entry per call (three).

A space with no `spaceId` in `.object/space.json` gets it on the first app write (the version history's snapshot), never on open; the script would set that one added key aside and say so. On the fixture no such write happens (a sync keeps no version).

## Automated results

Run on 2026-11-10 for this integration (Linux, the shared venv's Python with the worktree's `backend` first; `objectapp-mcp` through the `uv` shim):

| What | Command | Result |
|---|---|---|
| M29 acceptance | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m29_acceptance.py` | PASS, all nine checks |
| M28 acceptance (the IT ops starter) | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m28_acceptance.py` | PASS |
| M22 acceptance (work fields, MCP) | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m22_acceptance.py` | PASS (its MCP check lists 69 tools for a read-write token) |

The full back-end and front-end suites, `m11_acceptance.py` and the build run in the gate after the review.

## Sending facts with `curl`

Make a "Synced facts only" token in Settings > Integrations (it is shown once), then, with Object running:

```sh
curl -s http://127.0.0.1:8790/api/v1/synced/host \
  -H "Authorization: Bearer obj_..." -H "Content-Type: application/json" \
  -d '{"items": [{"match": {"by": "title", "value": "APP03"},
                  "values": {"lastBoot": "2026-11-10T07:12:00.000Z", "diskFree": 41.5,
                             "patchState": "Current", "rebootPending": false,
                             "lastSeen": "2026-11-10T09:55:00.000Z"}}]}'
```

The answer lists one result per item: `updated` (with the object's path), `notFound`, `ambiguous` (with the paths) or `invalid` (with why). Match by `"alias"`, or by `"key"` with `"key": "fqdn"` (a text or URL property that isn't synced). `null` for a key removes that value; keys not sent are kept. An MCP client with the same token gets the `sync_facts` tool and the read tools only.

## How it behaves (from the build)

- **The synced mark** is a property's top-level `synced: {source, staleAfterDays}` in the type JSON (text, URL, number, checkbox, both date kinds and label only; source 1-60 characters; stale after 1-365 days, default 7). Values live in `.object/synced/<typeId>.json`, keyed by object id, never in the `.md`; a value typed into the file under a synced key is ignored everywhere (display, filters, queries, computed values) and never removed.
- **The starter's Host** has five synced facts at the end of its properties, always shown: Last boot (date and time), Disk free (number, "Free disk space, in GB"), Patch state (Current, Pending, Failed, Unknown), Reboot pending (checkbox) and Last seen (date and time), each from "Inventory script", stale after 7 days. A Host, Network or Software added from the gallery gets its name patterns (and Host its synced facts). A Host type written before M29 is never topped up.
- **A sync** (`POST /api/v1/synced/{type}` with a `read-write` or `sync` token, or the MCP `sync_facts` tool) matches by title, alias or a key property, exactly after trimming, collapsing spaces and case folding, within the type, never a template or an object excluded from AI. It writes only the store, in one atomic write; an object with no `id` gets its `id` line on its first sync (no version kept) and is never touched again. One `synced` event and one activity entry per call.
- **A `sync` token** reads like `read` and writes only synced facts (any other v1 write is 403 "This token can only write synced facts."; a `read` token on the sync route is 403 "This token can't write synced facts."); `GET /api/v1/whoami` says `scope: "sync"`. v1 rows, peeks and object reads carry `syncedAt` for types with synced properties.
- **Read-only everywhere**: the property panel, a table cell and a Kanban drag between Patch state columns refuse with `"<name>" is filled by <source> and can't be edited.`; so do `PUT /api/object/properties`, `/api/v1/object/properties`, an automation's Set or Clear property, a create with values and the work routes.
- **The object page** shows a synced row read-only with `<source> · Refreshed <time ago>` (or `<source> · Not refreshed yet`) under it; after the stale-after days the value is muted and marked "Stale". Exports (HTML, Word, LaTeX, Markdown) include the synced values; the file on disk is untouched.
- **Suggested type**: `[[` / `@` with a query gains "New '<q>'" with the suggested type's chip and "Suggested", then "Other types" (every other writable type); a relation picker gains "Create '<q>'" per allowed type, the suggested one first; "+ New object" without a type lists the suggested type first; the palette's create row uses the suggested type; Turn into object lists it first and `I` uses it. The suggestion is the context's type (a relation's allowed types, else the collection's or query's), then a type whose name patterns match, else the type used last in this space (kept per viewer and space in localStorage `object.lastType:<root>`). No suggestion keeps Page. Picking a type applies its default template.
- **Name patterns** (`namePatterns` in the type JSON): `*` any non-space run, `?` one non-space character, `#` a digit, `@` a letter, `\` escapes, or exactly one of `{ip}`, `{cidr}`, `{fqdn}`, `{version}`; the whole name must match, case-insensitive. A bad pattern is ignored when suggesting and refused on save (422); globs are matched by a linear state-set matcher, never a backtracking regex.

## Hand checks (Gene)

On a copy of your space (and a new scratch space for the first one):

- [ ] Create a space with "IT operations": Host shows Last boot, Disk free, Patch state, Reboot pending and Last seen, each with "Inventory script · Not refreshed yet".
- [ ] Make a "Synced facts only" token in Settings > Integrations and send one host's facts with `curl` (the example above); the Host page shows them with "Refreshed just now", and nothing in the `.md` changed (`git status` shows only `.object/synced/`).
- [ ] The synced rows offer no editor in the page, the table or a Kanban board grouped by Patch state.
- [ ] Set the clock or wait: after 7 days the values show muted with "Stale".
- [ ] Filter a Hosts table by Patch state is Failed, and sort by Disk free: synced values work as any property.
- [ ] Type `[[APP03` in a page: "New 'APP03'" offers Host first, marked Suggested; "Other types" lists the rest.
- [ ] Type `10.30.0.0/24` in the palette: the create row is "Create new Network with title …"; `SQL Server 2022` suggests Software.
- [ ] On a collection of Applications, "+ New" lists Application first.
- [ ] In a Host's Operating system relation, typing a new name offers "Create 'Windows Server 2022'" as Software.
- [ ] Turn a line "PRN-TEST-02" into an object with `I`: it becomes a Host with the Host template's sections.
- [ ] Add a name pattern of your own in a type's settings; a bad one (`{foo}`) is refused.
- [ ] Property settings of a text, number, checkbox, date or label property show "Synced" with "Synced from a script or agent", Source and "Stale after"; turning it on needs a source; a relation or formula property doesn't offer it (T12).
- [ ] Settings > Integrations offers "Synced facts only" as a token scope, and the token list labels such a token "Synced facts only" (T12).
- [ ] Opening the space and browsing changes no file (git status clean).
