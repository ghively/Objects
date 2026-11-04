# Getting started

Object keeps your notes as plain Markdown files in a folder on this computer. Nothing leaves the machine: there is no account, no cloud and no sync.

## Spaces

A space is one folder. Each space has its own types, objects and settings. Switch spaces, or create a new one, from the space menu at the top left of the sidebar.

## Objects and types

Everything you write is an object: a page, a person, a project, a task, a tag. Every object has a type, and the type decides its icon, its color and the properties it carries. The sidebar lists your object types under Object Types; click one to see all its objects. Use **New** (Ctrl+U) to create an object, and the `+` beside Object Types to create a type of your own.

## Properties

Properties are the fields of an object: a status, a date, a number, a checkbox, a link to other objects. Each type defines its own. They show in the property pane beside the page and in the header under the title. An empty property reads "Empty"; click it to set a value.

## Links

Type `@` or `[[` in a page and pick an object to link to it. A link is stored as `[[Title]]` in the file. The page you linked to lists every page that links back to it under its references, along with unlinked mentions: places that name it without a link yet. Renaming an object updates the links to it.

## Daily notes

The Calendar holds one daily note per day. Open it from the sidebar; press T in the calendar to jump to today. You can mark a daily note reviewed when you are done with it.

## Collections and queries

A collection is a hand-picked group of objects of a type, such as "Reading list" under Books; a type's collections sit under it in the sidebar. A query is a saved filter over the whole space that keeps itself up to date: every open task due this week, every person tagged "Team". Open Queries from the Object Types list, and embed a collection or a query in any page.

## Search

Press Ctrl+K (or Ctrl+P), or click the magnifying glass at the top of the sidebar, to search this space by title and content. Ctrl+F finds text in the page you are on.

## Where your files live

Each object is one `.md` file in its type's folder, for example `Pages/Meeting notes.md` or `DailyNotes/2026-11-04.md`. Its properties are in the front matter at the top of the file and its body is ordinary Markdown, so any text editor can read it. The `.object/` folder holds the space's own data as readable JSON: the type definitions, saved views, collections, queries and the sidebar layout. The `.object-cache/` folder is a search index that Object rebuilds when needed. Images and other files go in `Attachments/`.

Press Ctrl+Shift+B at any time to see every keyboard shortcut.
