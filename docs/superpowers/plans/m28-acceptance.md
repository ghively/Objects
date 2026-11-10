# M28 acceptance: the IT ops starter and two-way relations

Status (2026-11-10): built 2026-11-10 on parallel lanes by file ownership (T1-T10, merged on `ccr-9c93c0c4-ssxqz7` up to `78a2f8af`), integrated in T11; the acceptance script passes. The whole-milestone review, its fix pass and the full gate come next. Gene's hand checks below are unticked.

Plan: `2026-11-09-m28-itops-starter-and-relations.md`. Design: `specs/2026-11-09-it-ops-type-model-design.md`, sections 1, 2, 5a (the Source type and the Sources / Distilled into pair only) and 6.

## How to run the acceptance script

```
uv run python scripts/m28_acceptance.py [SPACE] [--keep]
```

(In a container where `uv run` can't sync, the same with the venv's Python: `PYTHONPATH=scripts:backend .venv/bin/python scripts/m28_acceptance.py`.)

SPACE defaults to `backend/tests/fixtures/space-itops` and is never touched: the script copies it to a temporary folder, commits the copy to a throw-away git repo (again after one open), points `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` at temporary paths outside it and serves the app on a free `127.0.0.1` port. No agent runs, so the fake `claude` is not needed. It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any failure. The checks, in the order they run (the rows and the graph are read before the counterpart edits change the links):

1. Reads write nothing: `GET /api/space`, `GET /api/object` of every object, `POST /api/rows` (every type), `GET /api/graph`, `GET /api/type-gallery`; `git status` clean.
2. `POST /api/spaces` with `setup: "itops"` makes a space with the 17 IT ops types, 16 templates and the 30 seed tags; an empty folder served on its own gets the same from `POST /api/space/setup {"setup": "itops"}`; a second pick is 409 "This space already has a starting point."
3. APP-TEST-01's counterparts: Runs (Inventory app, inventory-web, the second through the alias `app01`), Documented in (Restart the inventory app); Rack A's Contains lists APP-TEST-01 (the Host template's link doesn't count); Windows Server 2022's Installed on lists both hosts.
4. `POST /api/rows {"typeIds": ["host"]}`: APP-TEST-01's `values.runs` holds the two EntityRefs.
5. `GET /api/graph`: the Inventory app and APP-TEST-01 pair is labelled "Runs on".
6. `POST /api/object/counterpart` adds Inventory app to DB-TEST-01's Runs: only `Applications/Inventory app.md` changes, and only its `runsOn` and `lastUpdated` lines; DB-TEST-01's file is unchanged.
7. Removing it again from APP-TEST-01's Runs (a CRLF + BOM file): APP-TEST-01's bytes are unchanged; Inventory app's `runsOn` is `[[DB-TEST-01]]` alone.
8. `PUT /api/types/application` with Runs on's other side keyed `category` is 422 `Host already has a property with the key "category".`; the type file is unchanged.
9. `GET /api/v1/object` with a read token made through `/api/integrations/tokens` carries `counterparts`.
10. `git status` lists only `Applications/Inventory app.md`, nothing in `.object/`.

Checks 6 and 10 set aside one write that isn't M28's: the fixture's `space.json` has no `spaceId`, and the first app write to such a space adds it (the version history keys versions by it, 2026-11-08; never on open). The script accepts `.object/space.json` only when that added key is its sole change, and says so in its output.

## Automated results

Run on 2026-11-10 for this integration (Linux, the shared venv's Python with the worktree's `backend` first):

| What | Command | Result |
|---|---|---|
| M28 acceptance | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m28_acceptance.py` | PASS, all ten checks |
| M8 acceptance (setup, basic types) | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m8_acceptance.py backend/tests/fixtures/space-sample` | PASS, the editor round trip included |
| M22 acceptance (work fields) | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m22_acceptance.py` | PASS (its MCP check started `objectapp-mcp` from the venv) |

The full back-end and front-end suites run in the gate after the review.

## How it behaves (from the build)

- **IT operations** is the third choice in "Create new space" and "Pick a starting point", between "Start with basic setup" and "Empty space". It writes the 17 types, 16 default templates (Source has none) and 30 seed tags, and never replaces a type, template or Tag that is already there.
- **The gallery** has an "IT operations" group (13 types: Person, Meeting and Project stay the basic entries; Source isn't offered). An IT ops type added from the gallery gets its default template, unlike the older entries. Relations point at the space's own types: Location's "Part of" points at Location; Application's "Runs on" points at Host once the space has one (with no Host it allows any type and keeps its other side "Runs").
- **Counterpart rows** come after the type's own properties on the object page, with the same row chrome. Rows with one name from several sources merge (Script, Command and Runbook give one "Documented in"). An empty row waits under the property panel's existing "Hidden (n)" toggle. A source open to any type (Command and Runbook "Covers") puts no definition on every type: its row shows on any object only while it has a value.
- **Editing a counterpart row** writes each other object's stored property (one ordinary property edit each); the object you are on is never written. A single-valued source (Operating system, Located at, Part of) is replaced, not appended.
- **In views** counterpart values filter, sort and group like any relation. Their table columns are read-only (edit them on the object page), and a board grouped by a counterpart refuses drops, since a counterpart is never stored.
- **Property settings** of a relation (not on basic types, and not on a relation that already syncs both ways, which shows "This relation already syncs both ways.") have "Show on the other side as" (placeholder "No other side"): a new name sets the other side, renaming keeps its key, clearing removes it. A key taken on a target type is refused with the server's text.
- **Graph edge labels** are the stored relation names (both directions joined by " · "), shown only on the edges of the hovered node, or of the local graph's centre while nothing is hovered, and hidden with the node labels while "Show simplified graph" is on.

## Hand checks (Gene)

On a copy of your space (and a new scratch space for the first three):

- [ ] "Create new space" offers Start with basic setup, IT operations and Empty space; IT operations makes a space whose sidebar lists Host, Software, Application, … Source, Incident, Meeting.
- [ ] An empty folder opened with `--space` asks "Pick a starting point" with the same three choices.
- [ ] A new Host opens with Purpose, Access and Known issues, and its properties (Category, Roles, IP address, FQDN, …) shown.
- [ ] Tags lists the 30 seed tags; none is tied to a past employer or is personal.
- [ ] Link an Application to a Host with Runs on: the Host shows a "Runs" row with the Application; add a second Application from the Host's Runs row: the Application's file changes, the Host's doesn't (git or version history).
- [ ] A Host shows one "Documented in" row for scripts, commands and runbooks together. A Command or Runbook covering a Page puts "Documented in" on that Page only while it has a value.
- [ ] An empty counterpart row (a Host's "Configured by" with no configuration) is under "Hidden (n)" until you show hidden properties.
- [ ] On the Hosts type page, filter, sort and group by Runs. The Runs table column is read-only; on a board grouped by Runs, dropping a card on another column is refused.
- [ ] The graph labels a Runs on edge when you hover the Host (only that node's edges are labelled); on a local graph the centre's edges are labelled; "Show simplified graph" hides the labels.
- [ ] In an existing space, the gallery's IT operations group adds Host alone, with its default template; adding Application later makes Runs on point at it; Location's Part of points at Location.
- [ ] Property settings of a relation: "Show on the other side as" names its other side; the target shows the new row.
- [ ] Opening the space and browsing changes no file (git status clean).
- [ ] Check G1-G4 as Gene decided them on 2026-11-10 (M31 plan): G1 Location's Part of with the other side Contains (kept); G2 the Project statuses and Priority (kept); G3 an Incident has one Resolved, its own date and time, which Desk sync fills (no second "Resolved" among its ticket fields); G4 "its properties shown" as always-shown properties (kept).
