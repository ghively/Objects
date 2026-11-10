# M31 acceptance: completion (everything specified and not yet built)

Status (2026-11-10): built 2026-11-10 (the contract `34cd1954`, then lanes A, B, C, D1, D2, E1, E2 and F by file
ownership, all merged at `4d08f8ef`), integrated here; the acceptance script passes. The whole-milestone review, its
fix pass and the full gate come next. Gene's hand checks below are unticked.

Plan: `2026-11-10-m31-completion.md` (Gene's decisions of 2026-11-10, the item table, the contract). The bar is the
behaviour catalog's wording (`docs/behavior-catalog.md`, the lines marked "(M31)").

## How to run the acceptance script

```
uv run python scripts/m31_acceptance.py [--keep]
```

(In a container where `uv run` can't sync, the same with the venv's Python: `PYTHONPATH=scripts:backend .venv/bin/python scripts/m31_acceptance.py`.)

The script copies the synthetic fixture spaces it needs (`space-sample`, `space-whiteboard`, `space-itops`,
`space-m8`) to a temporary folder (the fixtures are hashed before and after and never touched), points
`OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` at temporary folders and serves `create_app` on a free `127.0.0.1` port for
each part; the synthetic git repository and import sources are written by the script. No real data, no network, no
agent (so no fake `claude` either). It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits
non-zero on any failure. `--keep` keeps the temporary folder. The checks, by the plan's item numbers (the items with no
back-end behaviour are hand checks only):

1. **Full Export.** Two registered spaces (copies of `space-sample` and `space-whiteboard`), the first served.
   `POST /api/full-export` of the open space into a temporary folder, three times: Include media and Links as wikilinks
   on; Add the title as a top heading on; Links as wikilinks off. Each makes a dated folder `Object export <space>
   <date time>` holding every object; each file's bytes are what `GET /api/object/export` gives with the same options
   (with wikilinks off: the single-object export's rules, `export._markdown`, at the object's own path, which is where
   the full export puts it; over HTTP the single export puts the file at the top of its download, so its relative
   links start elsewhere); media is copied only with Include media. "Export All Spaces" (`scope: all`) holds one folder
   per registered space. A folder inside a space, the other space's folder, a missing folder and a relative path are
   each refused 422; no export folder appears in a space and neither space changes (every file hashed). The automated
   export, on the `OBJECT_CLOCK_FILE` clock: a folder inside a space shows as `blocked`; set to a good folder, daily,
   a server start at 2026-11-10 09:05 UTC runs one export (`lastRun`, `nextRun` the next day), a start 23 hours later
   runs none, a start 24 hours later runs the next into its own dated folder; the space never changes.
2. **Saved queries over `/api/v1`.** A synthetic space (Pages and a Server type with a number, collections Tooling and
   Ops, three tags, one page excluded from AI). Eight saved queries: search text, tags any of, tags all of, excluded
   types, left-out tags, in no collection, "not these collections, and these", and one with collection rules, search
   text and a left-out tag together. `POST /api/v1/queries/{id}/run` (a read token) lists the same titles, in the same
   order, as the app's own two steps (`POST /api/rows` with the query's scope, then `queryeval.run_query`), and the
   expected list; the page excluded from AI never shows.
3. **Conventions in every space, and one Resolved.** In a copy of `space-sample` (no setup, none of the IT ops types)
   a draft import batch and an agent's proposal over `/api/v1/import/proposal`: a new type "Box" with Project's
   properties shows "It has the same properties as Project." and the offer "Use Project, with a category", while "Rack"
   with two properties named like Server's (Cores, Owner) is no look-alike (the fix pass's tuning); "Docs" (a tag
   name) is "a category: a property value or a tag, not a type."; the relation "Backs up" to Vault (neither in the space
   nor proposed) stays a plain link; no type file is written. A new space made with the IT ops setup has an Incident with one Resolved (`resolved`, a date and
   time) and no `deskResolved`; the type gallery's Incident lists Resolved once.
4. **Git provenance.** A synthetic repository (two commits by "Ada Example", an `origin` on GitHub never fetched, one
   file changed since the commit, one never committed); its `docs` folder imported into a new space. Each object's
   `importSource` says `system: wiki`, the commit, the GitHub link at that commit and the last commit's author and date
   (a file changed in the second commit has that date); the changed and the untracked file are `uncommitted` (the
   untracked one with no commit and a `file:` link); the report's Git section names the commit and both files; the
   repository and its `git status` are unchanged.
5. **Remodel.** With a copy of `space-itops` open, importing its own folder into a new space: the preview reads types
   from each object's `type`; the new space has every type of the space, those with no object included (in
   `space-itops`: Command, Meeting, Project, Prompt, Script, Source), each with its plural, icon, colour, properties
   and options as the space defines it (the new space's own Page and Tag, whose properties are fixed, stay as they
   are; templates are not carried), and each of the 16 objects at its own path with its type, APP-TEST-01 still
   Located at `[[Rack A]]` and naming where it came from; the original space is byte for byte the same.
9. **Definition history** (a copy of `space-m8`). A collection (renamed), a saved query and a type (their descriptions
   edited): each edit keeps the earlier version; `POST /api/history/definition/restore` with the revision from before
   the edit is 409 with the current revision and writes nothing (no file change, no new version); with the current
   revision it puts the earlier version back (same id), the edited state kept as a version.
13. **The Table property.** A Table property (`simpleTableBlock`) added to a new type; `PUT /api/object/properties`
    writes a table (with an escaped `|` in a cell) as a Markdown table in a `|-` block, changing only its own lines and
    `lastUpdated`; it reads back from `POST /api/rows` as written; a value that is not a table is 422 and writes
    nothing; changing the property from Table to Number is 422 "This property type cannot be changed. If you need to
    change it, please add a ticket to our feedback board including the types you need." and the type file is unchanged.
14. **The Page link view.** A type's link view set to Wide card, then Page: the save changes only the
    `"defaultViewType"` line of the type file, and the type reads back with `page`.
15. **Local Storage and Clear media cache.** `GET /api/storage` answers the space, cache and state parts and the total
    and writes nothing (the space folder and the state folder hashed). With synthetic files in the cache's `media/` and
    `thumbnails/`, `POST /api/storage/clear-media-cache` answers `{files: 2, bytes: 500}`, removes those two folders
    and keeps every other cache file and the space as they were.

Then the fixture folders are checked unchanged.

## Automated results

Run on 2026-11-10 at `4d08f8ef` plus this integration (Linux, the shared venv's Python with the worktree's `backend`
first; `objectapp-mcp` through the `uv` shim where a script starts it):

| What | Command | Result |
|---|---|---|
| M31 acceptance | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m31_acceptance.py` | RESULT: PASS (66 checks, about 16 s) |
| M30 acceptance | `... scripts/m30_acceptance.py` | RESULT: PASS |
| M29 acceptance | `... scripts/m29_acceptance.py` | RESULT: PASS |
| M28 acceptance | `... scripts/m28_acceptance.py` | RESULT: PASS |
| M25 acceptance (provenance and re-runs) | `cd backend && PYTHONPATH=../scripts:. ../.venv/bin/python ../scripts/m25_acceptance.py` | RESULT: PASS |

No check failed because of a product bug. The fix pass changed one thing check 5 shows: a remodel used to make only
the types the space's objects use, so a type with no objects was not carried over; it now carries every type of the
space from its `.object/types`, empty ones included, and the check lists them in a note.

The full back-end and front-end suites, `tsc`, lint and the build run in the gate after the review.

## Hand checks (Gene)

On a copy of a space (synthetic pages only), in the app:

**Full Export (item 1)**

- [ ] Settings has a "Full Export" page (in the general group, after Import Content), with "Manual Full Export" (Spaces: This space or All Spaces; Include media, Links as wikilinks, Add the title as a top heading; Folder; "Export" and "Export All Spaces") and "Automated Full Exports".
- [ ] Export this space into an empty folder outside your spaces: it shows "Exporting… n of m files", then "Exported n objects and m media files to <folder>"; the new dated folder holds one folder for the space with every note as a Markdown file and the attachments.
- [ ] With Links as wikilinks off the links in the exported files are relative Markdown links that open the right file; with Add the title as a top heading each file opens with its title.
- [ ] "Export All Spaces" makes one dated folder with a folder for each of your spaces.
- [ ] A folder inside a space is refused with a message saying to pick a folder outside your spaces; your space shows no new files afterwards.
- [ ] Turn Automated Full Exports on, Daily, with a good folder: Last export and Next export fill in after the next start (or within a minute); with the folder inside a space it says why it is skipped.

**Saved queries over the API (item 2)**

- [ ] A saved query with search text, a tag and an excluded type lists the same objects in the app and through the assistant or an MCP client's `run_saved_query`; an object excluded from AI is left out of the second.

**Conventions in every space, and one Resolved (item 3)**

- [ ] In a space not set up as IT operations, an import whose proposal makes a type with an existing type's properties is refused with "Use <type>, with a category"; a tag name proposed as a type is called a category.
- [ ] A new Incident (from the IT operations starter or the type gallery) shows one "Resolved", a date and time, and no second Resolved among its ticket fields.

**Git provenance (item 4)**

- [ ] Import a synthetic folder that sits in a git repository with a GitHub remote: an imported object's Source line shows "commit <first 7 characters>" and its link opens the file's page on GitHub at that commit; a file you changed but did not commit shows "has uncommitted changes"; the import report has a Git section.

**Remodel this space (item 5)**

- [ ] Settings > Import Content > "Remodel this space…" opens the import dialog with this space's folder as the source and "A new space" as the only target (named "<space> (remodelled)"), and the note that the space is only read.
- [ ] After the import the new space has your objects in their types and folders, with their links, and every type of your space (one with no objects too) with its icon, colour and properties; the original space is unchanged.

**Explore panel (item 6)**

- [ ] With nothing open in the side panel, Ctrl+Shift+Right opens it on "New Sidepanel Tab" with the tabs "Explore" (first) and "Relevant Content"; Ctrl+Shift+Right again closes it, and the top bar button's tooltip says "Hide sidepanel" while it is open.
- [ ] Explore shows the cards "AI Chat" and "Search" (AI Chat hidden with "Hide AI features"), and Graph View and Backlinks as small buttons; each opens in the panel.
- [ ] Relevant Content lists objects related to the open page and "Find More" opens the search; with no page open it says "Open a page to see content related to it."

**The collection peek (item 7)**

- [ ] In a type's Overview, a click on a collection tile opens it in a peek (Ctrl or Cmd+click opens the page in a new tab): its icon and name, the view toolbar, "Search title...", `...`, New (split when the type has templates) and "Open as page", the type's chip, the cards and a "+ New object" row.
- [ ] The peek's stepper shows "1 / 3" (for a type with three collections) and Previous / Next step through them; "Open as page" opens the collection's page in the tab; "+ New object" opens the new object in a peek over the collection's.

**Graph controls (item 8)**

- [ ] On the graph page the top right shows a count pill ("N objects shown" on hover) that changes with the filters, a document icon ("Open as list") and a history icon ("Recently opened").
- [ ] "Open as list" lists the shown objects by title and a pick peeks one with the list as the pager; "Recently opened" lists the objects you opened lately and a pick finds it on the graph.
- [ ] Bottom right: Zoom out, the zoom menu (Page Fit, 5%, 10%, 25%, 50%, 75%, 100%, 150%, 200%, 300%), Zoom in, "Export view as PNG" and Customize; the menu shows the zoom now, after wheel zooms too.

**Definition Version History (item 9)**

- [ ] "Version History" in an object type's settings header lists its versions newest first; a picked one shows "In this version", "Changed since" and the "Definition file"; "Restore this version" asks "Restore this version?" and puts it back; a version that would remove values asks "Apply changes?" first.
- [ ] The same from a collection's `...` menu and a saved query's `...` menu.

**Inline #tag (item 10)**

- [ ] Typing `#urgent` in a paragraph shows it as a coloured chip (the Tag's colour, gray with no Tag); the file still holds the plain `#urgent`; a click opens the Tag (or, with no Tag, a search for `#urgent` in a new tab); `#123`, text in code and a URL's `#anchor` stay plain.

**Page shortcuts (item 11)**

- [ ] Ctrl+Alt+Shift+A selects every top-level block of the page or peek; Ctrl+Alt+Shift+L copies the object's `[[Title]]` and shows "Deep link copied"; Home, End, Page Up and Page Down scroll the page when the caret is not in a text field.

**Hide App Menu (item 12)**

- [ ] Settings > Editor "Hide App Menu" on hides the top bar's space menu (the sidebar toggle stays); a lone Alt tap shows it, focused, and another hides it; off brings it back for good.

**The Table property (item 13)**

- [ ] Add Property lists "Table" after Files; on an object the panel edits cells, "Add row", "Add column" and × on a row (never the header row) or a column; the file holds a Markdown table.
- [ ] A table view or card shows "N rows" with the column names on hover, and a table view's opens the table in a peek; search finds a word from a cell.
- [ ] "Change property type" turns a Table into Text or Text block ("a, b; c, d") and a Text into a Table (one cell under the property's name); Table to Number is refused with the catalog's message.

**The Page link view (item 14)**

- [ ] A type's "Card view and linking" > Default link view offers Page after Embed; a link to an object of that type then shows a full-width, read-only page preview (cover, type, icon and title, description, the shown properties, the first lines); a click or Enter opens the object. An object block's `...` > Change Block View offers Page too.

**Settings odds and ends (item 15)**

- [ ] Settings > Appearance "App icon": the swatches Default, Red, Orange, Green, Blue, Purple, Pink, Gray recolour the browser tab's icon at once and the app window's icon at the next start.
- [ ] Settings > Integrations: the button reads "New API token"; with "Show developer information" on, a "Developer information" box with a copy button per value shows an object's id and file path under its properties, a type's id, folder and property keys in type settings, a property's key and id, a query's id and a collection's id and view key; off, no box anywhere.
- [ ] Settings > Offline & Sync: "Local Storage" lists the space folder, its cache and Object's data for it with a total; "Media loading" Required only shows images, video, audio and PDFs as a placeholder with "Load"; "Clear media cache" asks "Clear the media cache?", says what it freed, and leaves notes and files alone.

**Leftovers (item 16)**

- [ ] Nothing to see: the unreachable 501 branch in `server.py` is gone, and decisions A-1 (superseded) and English-only are recorded in the catalog and the decisions memo. `workseams.py`'s M24-era fallbacks are still there (not taken out in M31).

Deviations (from the integration):

- The single-object export over HTTP writes the file at the top of its download, so with Links as wikilinks off its
  relative links are worked out from there; the full export keeps each object at its own path. The script compares
  that case with the single-object export's rules at the object's own path (`export._markdown`), as
  `test_fullexport.py` does; the two other option sets are compared with `GET /api/object/export` itself.
- The automated export checks on a one-minute timer from server start; the script moves the clock
  (`OBJECT_CLOCK_FILE`) and starts the app again rather than waiting a day.
- Check 9 edits the type's description (a type version that would remove values, "Apply changes?", is the unit tests'
  and the hand check's).
