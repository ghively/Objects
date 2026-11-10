# Milestone 31: completion (everything specified and not yet built)

Date: 2026-11-10. Owner: Gene Hively. Source: `milestone-audit-2026-11-10.md`, "Not built", and Gene's answers the
same day (below). The bar is the behaviour catalog's wording (`docs/behavior-catalog.md`); where it says nothing,
the choice is ours and listed under "Our calls" in each lane's report and in the catalog line it adds.

## Gene's decisions (2026-11-10, multiple choice)

1. **Spaces never change behaviour.** "Everything should be universal for any space and not be designed for
   certain purposes." The import's conventions (no look-alike types, with the offer "Use <type>, with a category";
   categories never become types or entities; relations outside the named set become plain links) apply in
   **every** space. "IT operations" stays only as a starting set of types offered when a space is made (and in the
   type gallery); nothing anywhere behaves differently because a space was set up that way.
2. **G1** keep (Location "Part of", other side "Contains"). **G2** keep (Project statuses Back log, In progress,
   On hold, Complete; Priority Low, Medium, High; Tasks unchanged). **G4** keep (an IT ops type's own properties
   always shown).
3. **G3: drop the duplicate.** An Incident has one "Resolved" (its own date and time); the ticket fields' Resolved
   (`deskResolved`) is not on Incident. Desk sync writes an Incident's resolved time into its own Resolved. An Incident type made before M31 is left as it
   is (Gene, 2026-11-10: no tidy step): it keeps both, and desk sync writes to the ticket field's Resolved.
4. The 30 seed tags stay. "Keep pages as Sources" stays on everywhere (M30 call 25). Categories are the options of
   Category, Kind and Environment fields plus tag names (M30 call 26).
5. **A-1 superseded:** Find files and Search in files stay ordinary switches beside the shell (the CLI offers them).
6. **Full Export: manual and automated.**
7. **Interface language: English only;** the Language list sets date and number formats (recorded, not built).
8. **Explore panel and the collection peek match the catalog.**

## What to build

| # | Item | Catalog / spec | Lane |
|---|---|---|---|
| 1 | Full Export: manual (current space or all spaces; Include media, Links as wikilinks, Add the title as a top heading; "Export All Spaces") and automated (on/off, which spaces, a folder, daily or weekly; one dated export folder per run) | catalog §1 General "Full Export" | A |
| 2 | Saved queries over `/api/v1` and MCP apply every part of the query the app applies (search text, tags, excluded types, collection rules), so an agent sees what the app shows | spec §3 queries, catalog §8; M11 call 4 | B |
| 3 | Rule 1 above (conventions in every space, no behaviour keyed on the setup) and G3 | Gene 2026-11-10 | C |
| 4 | Git provenance for an import whose source folder is a git repository: per file the commit, a web link at that commit (when the remote is a known web host), and the last commit's author and date | import design §1 table, Wiki row | C |
| 5 | Remodel an existing space: run the import (and its agent workflow) with the open space's folder as the source, written into a new space; the original is never changed | IT ops design §6 | C |
| 6 | Explore side panel: tab "Explore" with two cards (AI Chat, Search) and tab "Relevant Content" (objects related to the page) with "Find More"; Ctrl+Shift+Right toggles it, tooltip "Hide sidepanel" | catalog §7 | D1 |
| 7 | A collection opens in a peek: header (layout, Customize, search, `...`, split New, expand), the parent type's chip, the cards, a "+ New object" row, a stepper through the type's collections ("1 / 3"); expand opens today's tab page | catalog §9 | D1 |
| 8 | Graph controls: top right a count pill (objects shown), a document icon and a history icon; bottom right zoom out, a zoom dropdown (Page Fit, 5% ... 300%), zoom in, download (image), and the settings dropdown | catalog §7 | D2 |
| 9 | Definition history: a type's, collection's and saved query's earlier versions, previewed and restored (routes exist: `GET /api/history/definition`, `/definition/version`) | git-spaces design ("no definition-history UI yet") | D2 |
| 10 | Inline `#tag`: typed in a paragraph, renders as a coloured chip in the text | catalog §10 | E1 |
| 11 | Page shortcuts: Select all top-level blocks; Copy deep link; Scroll to top Home, bottom End, page up/down | catalog §2 Page | E1 |
| 12 | Editor "Hide App Menu" | catalog §1 Editor | E1 |
| 13 | Simple-table property kind (header row and column, text cells) | spec §3 Property kinds | E2 |
| 14 | The "page" link view for a type (beside inline, small card, wide card, embed) | spec §3 | E2 |
| 15 | Appearance "App icon" (colour per device); Integrations "Show developer information" (ids and paths shown in the UI) and the button label "New API token"; Offline & Sync: Local Storage (size estimate), Media loading (Everything \| Required only), Clear media cache | catalog §1 | F |
| 16 | Leftovers: `workseams.py` M24-era fallbacks, the unreachable 501 branch in `server.py`; docs for decisions 5 and 7 | audit | coordinator |

## Contract (done before the lanes, commit "feat(m31): contract")

Device settings, both ends (`settings.py`, `test_settings.py`, `frontend/src/api/types.ts`,
`frontend/src/settings/defaults.ts`): `appIcon` (`default`, `red`, `orange`, `green`, `blue`, `purple`, `pink`,
`gray`), `hideAppMenu`, `showDeveloperInfo`, `mediaLoading` (`everything` \| `required`), `fullExportMedia` (on),
`fullExportWikilinks`, `fullExportTitleHeading`, `fullExportAuto`, `fullExportScope` (`current` \| `all`),
`fullExportFolder` (absolute path or null), `fullExportInterval` (`daily` \| `weekly`).

## Lanes and file ownership

Each lane works in its own worktree, owns the files below, and puts new client calls and types in its **own new
file** (`frontend/src/api/<lane>Api.ts`), not in `client.ts`/`types.ts`, and new routes in its **own router module**
registered with one line in `server.py`. Catalog lines for what it builds go in the catalog section the item lives
in, marked "(M31)". Each item has tests that fail first; one commit per item.

- **A, Full Export:** new `backend/objectapp/fullexport.py` (+ scheduler start in `server.py`), its router, a new
  settings section file and its registration in `settings/SettingsModal.tsx` (sole owner of SettingsModal).
- **B, saved queries over the API:** `api_v1.py` (`run_saved_query`), a shared query evaluator module, MCP docs in
  `mcp_server.py` if a description changes.
- **C, import and universal rules:** `importers/` (proposal, provenance, source, readers as needed), `basicsetup.py`,
  `typetemplates.py`, desk sync / work fields for G3, `api_import*.py`, and the remodel entry point (a button in
  `settings/sections/ImportContent.tsx` and the import dialog's source).
- **D1, Explore and the collection peek:** `shell/SidePanelArea.tsx`, the peek (`object/ObjectPeek.tsx`), `nav/tabs.ts`,
  collection page components.
- **D2, graph controls and definition history:** `graph/` toolbar files, `history/` components, entry points in
  type settings, the query page and the collection page header (only the menu entry).
- **E1, editor:** `editor/` (an inline-tag extension), `lib/shortcuts.ts` and the page shortcut handlers,
  `settings/sections/Editor.tsx`, and the shell piece Hide App Menu hides.
- **E2, property kinds and link views:** `backend/objectapp/typemodel.py`/`properties` kind code, `frontend/src/properties/`,
  the table cell, `types/CardViewSettings.tsx` and where links render.
- **F, settings odds and ends:** `settings/sections/Appearance.tsx`, `Integrations.tsx`, `OfflineSync.tsx`, the icon
  and developer-info display, a storage-size route, the media cache.

Then one whole-milestone review, one fix pass, the full gate (both suites, `tsc`, lint, build, the 56-run
acceptance sweep) and `scripts/m31_acceptance.py` with `m31-acceptance.md` (Gene's hand checks).

## Our calls

- **Fix pass, lane A: the import conventions tuned** (Gene's rule 1 stays: the conventions apply in every space).
  Applied everywhere, the look-alike rule refused ordinary types on a fresh `basic` space ([Notes, Type] and [Genre,
  Rating] were "the same properties as Book", [Status, Notes] and [Status, Location] "as Project"). Now types are
  compared on their **specific** properties: the system properties and Notes, Type, Status, Cover image and Sources
  (`proposal.COMMON_PROPERTIES`) are left out, and a property counts as shared only with the same name (case, spacing
  and punctuation aside) and the same kind. A look-alike shares **at least 3** specific properties, and those are
  **80% or more of both types' specific properties together** (the union, not the new type's own list). In the schema
  proposal a relation whose target is an existing type, or a type proposed in the same proposal, is kept (a Notion-style
  "Author" to a proposed Writer); only a relation to neither stays a plain link ("It points at Vault, which is neither a
  type in this space nor one proposed here; it stays a plain link."); the named set stays the rule for the entities'
  relations (M30). A proposed name that is an option of a Category, Kind or Environment label is refused only when the
  item also shares 2 specific properties with the type holding it; otherwise it gets a note ("Workstation is also one
  of Host's Category options.") and the offer "Use <type>, with a category", and Apply is not blocked. A tag name is
  still refused.
