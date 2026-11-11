# Getting started

Object is a place to write notes and keep track of what you have to do. Your notes are plain Markdown files in a folder on this computer. Nothing leaves the machine: there is no account, no cloud and no sync.

## Your first five minutes

1. **Write a note.** Click **New** at the top of the sidebar, give the note a title, press Enter and write. There is nothing to save: the note saves itself as you go.
2. **Open today's note.** **Today's note** (Ctrl+Shift+D) opens a note for today, ready to type in. There is one per day, and the Calendar keeps them.
3. **Link two notes.** Type `[[` (or `@`) and start a name. Pick a note from the list, or keep typing a new name to make that note on the spot.
4. **Add a task with a date.** Open **Tasks** in the sidebar and type in **Add a task**, for example "Call the dentist friday". Enter adds it, due on Friday. In a note, `- [ ] ` at the start of a line makes a to-do, and Ctrl+Shift+T turns the line you are on into a task.
5. **Find things.** Ctrl+K (or Ctrl+P) searches every note by title and text. Ctrl+F finds text in the note you are on.
6. **Tag a note.** Type `#` and a word anywhere in a note. Click a tag to see every note that carries it.

## Finding your way around

**Home** is what an empty tab shows: **New note**, **Today's note**, the notes you edited last and the tasks due today. In the sidebar, **Notes** lists everything you wrote, newest first; **Calendar** shows your days, with each day's note and tasks; **Tasks** is your task list.

A note that is linked from elsewhere lists those places under it, along with unlinked mentions: places that name the note without a link yet. Renaming a note updates the links to it.

## Types and properties (optional)

A plain note needs nothing more than its text. When one kind of note always has the same details (a book's author and rating, a trip's dates, a meeting's attendees), give it a type. A type adds properties, the fields beside the text: a date, a status, a number, a link to other notes. Add a type with the `+` beside **Types** in the sidebar, from a ready-made one or your own. Each type then has its own page that lists its notes as a table, a board or a calendar.

A collection is a hand-picked group of notes of one type, such as a reading list. A saved search is a filter that keeps itself up to date, such as every open task due this week.

The Work page (a dashboard for tickets, queues and alerts) and the IT operations types are off until you turn them on: in Settings, under Work, and at the end of the type gallery.

## The Assistant

The Assistant is a helper you can ask: to find something in your notes, summarise a long one or draft some text. It works only when you ask it to, and it runs through Claude Code on this computer. If you would rather not see it, turn on "Hide AI features" in Settings.

## Spaces

A space is one folder with its own notes and settings: one for home and one for work, say. Switch spaces, or make a new one, from the space menu at the top left.

## Where your files live

Each note is one `.md` file: plain notes in `Pages/`, daily notes in `DailyNotes/`, for example `Pages/Meeting notes.md` or `DailyNotes/2026-11-04.md`. Its properties are in the front matter at the top of the file and its text is ordinary Markdown, so any text editor can read it. The `.object/` folder holds the space's own data as readable JSON, and `.object-cache/` is a search index that Object rebuilds when needed. Images and other files go in `Attachments/`.

Press Ctrl+Shift+B at any time to see every keyboard shortcut.
