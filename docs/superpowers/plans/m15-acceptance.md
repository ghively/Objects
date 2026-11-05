# Milestone 15 acceptance: importers

Plan: `2026-11-05-m15-importers.md` (expanded from the 2026-11-04 features plan, M15). Date: 2026-11-05. Built on a Linux cloud container, not on Gene's Windows PC, on branch `feat/m15-importers` off `master` at `c72567f` (it does not need M10 to M14).

## What was built

- **Sources** (`backend/objectapp/importers/`): a Notion "Markdown & CSV" export (zip, including a multi-part export of zips inside a zip), an Obsidian vault, or an Anytype Markdown export, as a `.zip` file or a folder named by its path on this computer. The server reads it in place: nothing is uploaded, extracted or written beside it.
- **Detection**: Obsidian (a `.obsidian/` folder), then Notion (id-suffixed names), else a plain Markdown folder read with the Obsidian rules. Anytype is never picked automatically; the user chooses it.
- **Preview** (`POST /api/import/preview`): writes nothing anywhere. It shows what would be imported: objects, types and their properties with guessed kinds, attachments and their size, how many links will resolve, repeated titles, and every skipped file with its reason.
- **Mapping**: "Make types from" (folders or a frontmatter key, for Obsidian and Anytype), and per type its name, plural, "Don't import" and, for this space, "Add to" an existing type; per property its name, kind, "Multiple values" and "Don't import".
- **Import** (`POST /api/import/start`, a polled job with "Stop import"): into a new space by default, or into this space when picked. Objects, types, attachments (copied byte for byte), tags and an "Import report" page are written as new files only; no existing file is ever changed. Links become wiki links to the imported objects; images and files go to `Attachments/`; callouts become standout quotes.
- **Dialog** (`frontend/src/import/`): Source, Review (summary, mappings, target), Running and Finished steps; opened from "Create new space" > "Import from…" and Settings > General > "Import Content", which has a line per source on how to make the export.

## Our choices (for Gene to check)

1. The source is a typed path, read in place; a path pasted with surrounding quotes (Windows "Copy as path") has them removed. No upload or file picker in v1.
2. Limits: 100,000 entries and 50,000 objects (refused), 512 MiB of text per preview, 20 MiB per Markdown or CSV file and 100 MiB per attachment (skipped); a zip inside the source zip is read into memory up to 256 MiB, larger ones through saved points so they are never inflated again from the start.
3. The preview is synchronous and writes nothing; up to 3 recent reads are kept for 30 minutes so mapping changes re-plan quickly. If a read has expired when Import is pressed, the dialog reads the export again and asks the user to check and press Import again.
4. A new space is the default target; this space only when picked; never another existing space.
5. Types: a Notion database is a type; an Obsidian top-level folder is a type; Anytype by its `type` key; everything else is a Page. Folder names are made singular with a small rule table (Movies to Movie, Classes to Class, Stories to Story; Series, Status and News kept); all names are editable.
6. Into this space, a planned type joins the existing type of the same name, but only custom types, Page and Task can take imported notes: Tag, Daily Note, Whiteboard and the media types are never matched and are refused if chosen, and read-only types are refused. Existing types only gain properties and label options.
7. Duplicate titles keep their title and get " (2)" in the file name, with path-form links; a taken type name gets " (2)"; two type folders that differ only in case get " (2)" so they stay apart on Windows.
8. Links with different text become `[[Title|text]]`, a heading is kept (`[[Title#Heading|text]]`), Obsidian's escaped `\|` in tables is read as the alias separator; links to databases or to pages outside the export become plain text.
9. Callouts become standout quotes with their emoji or title kept; other HTML Notion writes stays as written.
10. Obsidian's `Tags`, `Aliases`, `Title` and `Description` keys are read ignoring case; inline `#tags` become tags; display-only keys are dropped and listed once.
11. Frontmatter that can't be parsed is kept in a code block in the body; empty files and files no page links to are skipped and listed; `# Title` is added when a body has no heading.
12. A file that can't be written (a path too long on Windows, a permission error) is skipped and listed ("Couldn't be written: …"); the import goes on.
13. A stopped or failed import removes nothing and still writes the report; a stopped import's report notes that links to objects not imported stay unresolved. If the source is gone or changed before anything is written, no space is created.
14. While importing into this space nothing is announced per object; when the job ends one refresh is announced to every window, and the importing window refreshes itself too.
15. The Anytype reader is best effort and unverified against a real export; the preview and the report say so.
16. The review is one scrolling step (summary, mappings, target); the dialog keeps only what the user edited, so switching the target shows the server's matches; there is no close button while an import runs.
17. All labels are our strings, except "Import Content" and "Start importing" (the catalog's).

## Review

One whole-milestone review after the two lanes were merged found one high finding (a link whose target has parentheses, common in Notion exports, corrupted the page body), seven medium (the importing window never refreshed and other windows got thousands of events; multi-part Notion exports and many attachments took quadratic time; switching the dialog to this space kept new-space names and made duplicate types; a `Whiteboards/` folder was imported into the Whiteboard type, hiding its text; escaped `\|` links in tables weren't converted; two type folders differing only in case) and eight low ones, plus suggestions (public Space methods instead of private ones, singular names, list semantics and a calmer progress announcement, quoted paths, report wording, test gaps). All were fixed in one pass in two parts, each with a test seen failing first (choices 1, 2, 3, 5, 6, 7, 8, 10, 12, 13, 14 and 16).

## Automated results

| Suite | Command | Result |
|---|---|---|
| Baseline before M15 | `uv run pytest backend/tests -q` at `c72567f` | 1603 passed, 1 skipped, 3 xpassed |
| Back end | `uv run pytest backend/tests -q` | 1717 passed, 1 skipped, 3 xpassed (M15 adds 114 in `test_m15_*.py`) |
| Front end | `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | vitest 2573 passed, 1 skipped; `tsc` clean; lint 0 errors (warnings only, of kinds the code base already has); build ok; app icons current |
| M15 acceptance | `uv run python scripts/m15_acceptance.py backend/tests/fixtures/<space>` | PASS (all checks) on `space-sample` and `space-m8` |
| Earlier acceptance | `m2` (`space-sample`), `m8` (`space-m8`), `m9 --skip-roundtrip` (`space-m8`) | PASS |

`scripts/m15_acceptance.py` copies a space and the three synthetic export fixtures (zipped at run time) to a temp folder and serves the space on `127.0.0.1`: each preview writes nothing to the source, the space or the state dir; Obsidian, Notion and Anytype each import into a new space, which is registered; links resolve, including a title shared by two objects; attachments are byte-identical; the Import report lists skipped items; the sources are unchanged; a hostile zip with `..`, absolute and drive-letter entries writes nothing outside its target; a source changed after its preview is refused and creates nothing; an import into this space next to a same-named object leaves `git status` showing only new files.

Not verified here: the Windows run (paths over 260 characters, reserved names and backslashes are covered by tests only), the app's own window (pywebview), the dialog in a real browser (jsdom only), a real Notion export of several GB, and any real Anytype export.

## Known gaps

- The Anytype reader's marker, type key and files folder are guesses until a real export is checked.
- Writing takes about 5 ms per object (5,000 notes about 26 s); the app stays responsive meanwhile.
- When importing into this space, a file with the same title created during the import can make an earlier-written link ambiguous; the rename is listed in the report.
- A new-space location that isn't a folder first shows the "preview had expired" notice, then the real message on the second press.
- A vault folder named like a basic type the space doesn't have (say `Images/`) becomes an ordinary custom type.
- No drag-and-drop or native file picker.

## Hand-checks for Gene

- [ ] Settings > General > Import Content: each source shows its help line; "Start importing" opens the dialog.
- [ ] Export a small Notion workspace as "Markdown & CSV", paste the zip's path, Preview: counts, types and skipped items look right, and nothing appears beside the zip. Import into a new space, then Switch space: pages, databases as types, links, images and the Import report are there.
- [ ] Point it at an Obsidian vault folder: wikilinks, embeds, tags and callouts come through; the vault is unchanged (`git status` in the vault, if it is a repo).
- [ ] Import into This space: `git status` in the space shows only new files (and type files); the sidebar refreshes by itself.
- [ ] Stop an import partway: what was written stays, and the report says it stopped.
- [ ] If you have Anytype, export a few objects as Markdown and try it with "Exported from: Anytype"; tell me what the frontmatter looks like so the reader can be pinned.
- [ ] The dialog in Light and Dark, and with a keyboard only.
