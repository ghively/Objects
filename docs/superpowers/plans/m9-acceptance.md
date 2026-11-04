# Milestone 9 acceptance

Plan: `2026-10-28-m9-completeness-gaps.md`, Task 22. Date: 2026-10-28. Built on a Linux cloud container, not on Gene's Windows PC: Task 1 first, then five lanes in parallel worktrees (B back end, O object page, E editor, P properties and settings, V views and sidebar), merged, then one review, one fix pass and the gate. The walkthrough ran headless (Playwright with Chromium).

## Automated results

| Suite | Command | Result |
|---|---|---|
| Baseline before M9 | the gate below, at `a6bf658` | pytest 1203 passed, 1 skipped; vitest 1829 passed, 1 skipped; `tsc` clean; build ok |
| Gate after the merge (before the fix pass) | the gate below, at `c138f1d` | pytest 1230 passed, 1 skipped, 1 load-sensitive failure (`test_graph_5000_objects_under_300ms`, run alongside vitest; passed alone); vitest 1949 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok |
| Final gate (after the fix pass) | `uv run pytest backend/tests -q`; `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | pytest 1238 passed at `d17bd90`, 1239 at `35bbd88` after Gene's three answers; vitest 1966 passed, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`); `tsc` clean; lint 0 errors; build ok. Run one after the other on a quiet machine |
| M9 acceptance | `uv run python scripts/m9_acceptance.py backend/tests/fixtures/<space>` on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-whiteboard` | PASS 23/23 on each, the editor round trip included; rerun after the fix pass: PASS on each |
| Earlier milestones | `m1_roundtrip.py`, `m2_acceptance.py` … `m8_acceptance.py` on `space-sample` and `space-v1` | PASS before and after the fix pass (m2 52 and 50, m3 14, m4 24, m5 18, m6 19, m7 23, m8 26) |

### `scripts/m9_acceptance.py`

Usage: `uv run python scripts/m9_acceptance.py SPACE [--keep] [--skip-roundtrip]`. Built like `m8_acceptance.py`: a git-committed temp copy, with the state, cache and clock (2026-10-28T12:00:00Z) in temp paths, served with `create_app` on a free `127.0.0.1` port.

Seeds written before the commit: two PNGs, `Pages/M9 export.md` (references an image) and `Pages/M9 embed.md` (two `localDataViewInfo` embed annotations), plus space-m8's daily note when the space has none. Created over HTTP: an "M9 Meeting" type with a `datetime` property, a template and an object of that type, and a whiteboard. (The plan put the date property on Page, but basic types' properties can't be edited: 422.)

The checks:
1. Two starts plus every read (export with and without media, search, ui): `git status` clean, nothing new in the state dir.
2. Duplicate: exactly one new file, differing from the source only in `id`, `title`, the stamps and the `# Title` line. A daily note gives 422 (and the read-only `Bad yaml.md` in `space-sample`/`space-v1`).
3. Export: the `.md` bytes are identical; the zip holds the `.md` and the referenced image.
4. Layout keys: `wideLayoutMode`, `wideCoverImage` and `coverImageOffset` change only their own lines; changing `coverImage` drops the offset; wrong shapes give 422.
5. Template variable: `{creation:week}` is accepted on the template, refused on a plain object; creating from the template gives the week range.
6. Whiteboard: a board save changes only the `.md`'s `lastUpdated` line; a second save 30 s later leaves it; the Notes save after it succeeds with `mdVersion`.
7. `PUT /api/ui` `workspaceOrder` round-trips.
8. `POST /api/search/reindex` gives 202 and search reports complete afterwards.
9. The editor round trip (`roundtrip.space.test.ts`) reports 0 differences, `localDataViewInfo` embeds included.
10. The M1 no-edit pass changes 0 files.

### Headless walkthrough (Step 4)

On a scratch copy of `space-m8` (`uv run objectapp --space <copy> --browser`), every M9 feature was used once: 0 console errors, 0 requests leaving 127.0.0.1, opening the space wrote nothing.

| Feature | Result |
|---|---|
| Duplicate (`…` menu) | the copy opened; one new file; not offered on a daily note or a whiteboard |
| Text Stats | words, sentences, paragraphs, characters, Created at, Last updated |
| Export | `M9 export.md` and `M9 export.zip` (with `Attachments/m9 pixel.png`) |
| Page inspector | Outline jumps to headings; Stats tab; Pin/Unpin kept in localStorage |
| Wide / Normal layout | 724 px ↔ 936 px; writes `wideLayoutMode` |
| Cover | wide toggle writes `wideCoverImage`; reposition Save writes `coverImageOffset`, Cancel writes nothing |
| Content property | full block editor; reopening changes nothing |
| Text property | `[[` picker, link chip, stored as `[[Title]]` |
| Embedded query view | a layout change writes one `localDataViewInfo` annotation line; kept after reload |
| Alignment | block menu writes `align=center`; table bar turns `| --- |` into `| ---: |` |
| Row menu, Select multiple | on a type page and a query page; "2 selected" bar; bulk open in side panel |
| Import CSV | dialog strings and mapping; two rows made two objects |
| Query tab | Edit query locks the type; Release opens the query page |
| Template date variable | Week of creation → `{creation:week}`; New from template → `2026-10-26 -> 2026-11-01` |
| Recalculate content index | calls reindex; button disabled while polling |
| Sidebar order | saved in `ui.json` and kept after reload (the handle was hard to grab: fixed, below) |
| Whiteboard edit | only `lastUpdated` changed in the `.md`; the Notes save after it succeeded |

### Review and fix pass

One review in two halves (back end and file safety; front end and fidelity), plus the walkthrough's findings, then one fix pass, one finding per commit with a failing-first test:

Back end and whiteboard:
- **Notes base version** (`d475c67`): a board save returns `mdVersion` and `mdBaseVersion` only when its `lastUpdated` stamp actually wrote, and the Notes adopt it only when they hold `mdBaseVersion`. Before, a body change from another window could be overwritten. This changes the plan's contract ("else its current version").
- **Ink saves** (`daf639a`) hand the stamp to the Notes the same guarded way.
- **The saving window** (`5b69828`) now sees its own `.md` stamp (`announceLocalChange`).
- **Export with media** (`90a0bd1`) includes short-name embeds (`![[photo.png]]`), resolved as the editor does: exact, case-insensitive, then by file name.
- **Time-zone-less `lastUpdated`** (`f1cdb4b`) is read in the space's time zone by the stamp throttle; a stamp in the future no longer blocks the bump.
- **Basic Project Status** (`a16e652`) is a plain label in new spaces: `isStatus` is set only on the Task status. Existing type JSON is not rewritten. New Project types lose "By category" grouping.
- **`defaultPageViewId`** (`86a9c7d`, `a6a7efb`) is never inferred or shown as a property.

Front end:
- **Shift-click in a grouped view** (`3d46450`) selects the on-screen range only.
- **Import CSV:** blank lines are not imported (`6b88504`); the drop zone accepts a dropped file (`9728d26`).
- **Sidebar:** a section added after the order was saved appears above Pinned (`cc941e1`); the reorder handle is inside the sidebar's visible area and keyboard reorder moves past the tall Object Types block (`16125b5`).
- **Bulk delete dialog** (`e83e32a`): "Delete?" and "Review the items below, then confirm.", with the selected titles listed.
- **Stats and Text Stats** refresh "Last updated" after a property write (`f717d36`).
- **The page inspector** sits below a shown cover, clear of its buttons (`4b5c2e0`).
- **`[[` picker** (`669cafa`): characters typed after `[[` before the picker takes focus become its query (body and property cells). Not reproduced in jsdom; fixed from the code and covered by a simulation.
- **Content and Text cells** know their object (`91e9a6e`), so block-reference copying works there.
- **No-network test** covers the M9 sources (`d17bd90`).

## Rules the build chose, for Gene to confirm

Each is marked "our choice" or "our string" in the plan or by the lane that built it.

- **Whiteboard "Last updated":** the bump is throttled to 60 s and takes no version-history snapshot; a read-only `.md` is not stamped.
- **Duplicate:** refused for whiteboards (ours), templates and read-only files, besides daily notes and media; message "This object can't be duplicated." (ours); the copy opens in the current tab; from a row it opens in the peek. The targets of the copy's synced (two-way) relations gain a link to the copy (Gene, 2026-10-29).
- **Export:** Markdown only, with "Include media"; the `.md` at the zip root, media at their space-relative paths; icon `ph-export`.
- **Cover:** `referenceImageId` dropped (the offset is cleared when the image changes); reposition offered only for cropped covers; offset rounded to whole percent; the hover buttons are icons with their labels as tooltips.
- **Inspector:** a toggle button "Inspector" (ours), only on the full page, not in the peek; Outline leaves out headings inside embeds; `plainText` counts one paragraph per non-empty Markdown line.
- **Encyclopedia design:** the cover and title span the full width above the body and its info box, as before M9 (Gene, 2026-10-29; the alternative puts a non-wide cover above the content column only).
- **Object `…` menu order:** Present, Export, then Version History, Text Stats (Gene, 2026-10-29).
- **Wide layout item** sits just above "Raw Markdown"; hidden for index card and whiteboard objects.
- **Text property:** Enter, Shift+Enter, Escape and leaving end the edit; no slash menu or block handles in it.
- **Embedded views:** saved 300 ms after the last change; a read-only editor keeps changes in memory; toggling "Show details" alone never writes `localDataViewInfo`.
- **Alignment:** the block-menu submenu (after "Color") also offers alignment outside table cells; table-cell alignment sets the whole column (GFM has only column alignment); "left" removes the option.
- **Date variables:** the picker sits at the top of the date popover; "Template variable" is its accessible label only.
- **Recalculate content index:** in Space settings; polls every 1 s.
- **Row menu:** Change type is a submenu of types; Copy object reference copies `[[Title]]`; Shift-click selects without "Select multiple"; Ctrl-click still opens a new tab; the selection bar has "Clear selection" (ours).
- **Bulk change type** runs the one-object dialog once per object. Not built: bulk Edit property, Edit tags, Export.
- **Import CSV:** 1000-row limit (our choice); header row on by default; no template; labels take existing options only; tags, aliases and multi-entity cells split on commas; a new collection is named after the file; strings "Column {n}", "Import into", "Title" are ours.
- **Query tabs:** "Edit query" on a type's query tab is ours; "Release type constraint" is the button's accessible name (the tooltip is the visible label).
- **Sidebar order:** dragged by a grip handle ("Reorder {name}", ours); sections missing from the saved order keep their default place.
- **Searchable toggle:** not built (Gene's answer); `isNotSearchable` stays file-only.
- **Custom label as status:** not offered (guard test). The basic Project type no longer seeds `isStatus` (fix pass).
- **Default collection, `defaultPageViewId`:** no UI (a hidden read-only flag; a key of the page-design studio Object doesn't have). Both keys round-trip and are never shown or inferred as properties.

## Gene's hand-run checks

On a copy of the CPI export outside the repo, with `git init` done there:
- [ ] Opening the space, exporting and reading stats change nothing (`git status` clean).
- [ ] Duplicate a page, a task and a tag: the copies are named "<Title> (Copy)" and the source is untouched. Duplicating an object with a two-way relation: the related objects link the copy too. The menu offers no Duplicate on a daily note, template or whiteboard.
- [ ] Export a page as Markdown, then with "Include media": the zip opens, and images and attachments are inside (including `![[name.png]]` short-name embeds).
- [ ] Text Stats in the `…` menu and the inspector's Stats tab give the expected counts on the same note (words, sentences, paragraphs, characters).
- [ ] The page inspector: the Outline jumps to headings, and Pin/Unpin is remembered.
- [ ] Wide layout / Normal layout per object overrides the type. Toggling the wide cover and repositioning the cover (drag, Save, Cancel) look as the behaviour catalog describes. A new cover image resets the position.
- [ ] Content property: the full block editor works in the property panel. A note edited there reloads identically.
- [ ] Text property: `[[` opens the picker, links show as chips, and renaming the target updates the link.
- [ ] Template date variables: "Day/Week/Month/Year of creation" on a template's date property; a new object from it gets the right date or range.
- [ ] An embedded collection and an embedded query: change the layout, filter, sort and group, close and reopen, and they are kept. The note's diff is one annotation line.
- [ ] Alignment in the block menu and in the table bar.
- [ ] The row menu on a type page, a type dashboard section and a query page; Select multiple; bulk change type, open in side panel and delete.
- [ ] Import CSV into a type (with and without a header row, and a new collection); the warning shows.
- [ ] A single-type query tab: the type is locked and the release button works.
- [ ] Sidebar sections: drag to reorder, restart, and the order is kept.
- [ ] "Recalculate content index" runs and the indexing state shows.
- [ ] Draw on a whiteboard: its "Last updated" moves, at most once a minute. The board's Notes still save.
- [ ] Every rule in "Rules the build chose", against the behaviour catalog.
- [ ] The side-by-side look of every M9 screen in Light and Dark.
