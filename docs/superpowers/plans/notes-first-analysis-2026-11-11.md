# Notes-first analysis (2026-11-11)

Gene, 2026-11-11: "make it less specialized towards IT and more of a go to notes application, improving the polish
and functionality; lean less on the nonsense and heavier into the note taking, task tracking; AI is a helper, not the
primary operator. It leaned so heavy on the AI the human trying to organize his life got lost. I want to make sure
the manual note taking experience is first class and has all friction removed."

This file is the analysis behind that. The plan that follows from it is `2026-11-11-m32-notes-first.md`.

## How it was checked

1. **A hands-on walk** of a live headless copy of the app as someone who only wants to write notes and track tasks by
   hand: a brand-new empty folder, two spaces made with "Create space" (empty and basic setup) and a copy of
   `space-sample`; 14 everyday journeys, steps counted, 176 screenshots.
2. **A read-only inventory** of every default surface (sidebar, New, palette, slash menu, note page, Tasks page,
   Settings, start screen, Help, new-space defaults, the type gallery), each item tagged notes / tasks / structure /
   AI / IT-work, with the switches that exist and how separable each area is.
3. The coordinator's own look at the first screens, and a code check of the worst claim (autosave).

## Verdict

The writing core is good: the editor, `[[` links with backlinks and unlinked mentions, tags, paste, the Calendar's
Day view with its inline daily note, Ctrl+K search, the Trash, clean Markdown files. What went wrong is everything
around it. M10-M31 put AI, agents, a work dashboard and IT types on the default path, and the basics a notes app
needs first (somewhere to land, a task you can make, a save you can trust, keys that work while you type) were never
finished. A person opening Object to write something down meets a database and an agent console before a page.

## What a note-taker meets today

### Broken (stops you)

1. **A new space cannot make tasks.** Neither "Empty space" nor "Start with basic setup" has a Task type; "Create
   task" is greyed out with no reason given, quick add and Ctrl+Shift+T do nothing, and the type gallery has no Task
   entry. There is no way in the UI to get one.
2. **Typing can be lost.** The note saves one quiet second after the last key, every key restarts the wait, and
   nothing saves when the window closes (whiteboards do). Twelve sentences typed with short pauses, then a close,
   saved nothing. No "Saved" mark exists anywhere.
3. **Enter in the title throws the caret away.** A new note opens with the title selected (good); Enter blurs it and
   what you type next goes nowhere. Arrow down does nothing, and 15 Tabs walk the property pane without reaching the
   text.
4. **The keys that start writing are dead while you write.** With the caret in a note: new note (Ctrl+N, Ctrl+U) and
   today's note (Ctrl+Shift+D) do nothing. "Today's note" opens with focus on the dialog, not the text, so the first
   words are lost.

### In the way (slows you every time)

5. **The app opens on a dead end:** "Pick an object type / Choose a type in the sidebar to see its objects." No
   today's note, no recent notes. The first question a new folder asks is about types ("basic setup / IT operations
   / Empty space"), not about writing.
6. **The Tasks page is the work dashboard.** It opens on "Now", which said "Nothing is waiting on you" with one task
   overdue and one due today. Its second row is "Brain dump", Energy Low/Medium/High, "Just one thing" and "Agent is
   carrying 0 · 0 alerts"; half of its tabs are Your queues, Agent queue and Captures. The plain lists (Scheduled,
   Open, Completed…) sit under "More views". "Brain dump" is the most prominent box and does not make a task: it
   makes a "Capture" for an agent that isn't set up.
7. **A task carries a help desk.** The built-in Task type has 42 properties, 25 of them ticket and desk fields
   (Ticket ID, Desk status, Requester, Hypothesis, Confidence, Floor items…), added in memory to every Task and
   Project. Its settings say "Objects of this type are already work items."
8. **The note page gives the text 42% of the window** at 1440 px: sidebar 358, properties pane 370 (on by default,
   seven system rows on a blank page), text 609. A note clicked in a list opens as a pop-over, not a page. An empty
   body is 62 px tall with four reference tabs right under it.
9. **Dating a task takes five steps** (row, "Empty", pick, Esc, Esc); the date on a row is not clickable; quick add
   does not read "friday"; done tasks are not struck through and overdue dates are not red.
10. **Markdown habits misfire:** `- [ ] ` gives a bullet reading "[ ]"; `> ` makes a toggle, not a quote;
    `notes.md` becomes a web link. A new linked note takes the last type you made, so after a task, `[[New thing]]`
    becomes a Task.
11. **Nothing lists what you wrote lately.** "All notes" was taken off the sidebar (2026-11-08) and is reached only
    from the palette; it is grouped by creation date, not last edited, and leaves out daily notes.

### Weight (what makes it feel like someone else's tool)

12. **AI and agents hold the top of the app:** Assistant and an always-shown Agents section are two of the six fixed
    sidebar entries; "AI Chat" leads the side panel and every pop-over's toolbar; two AI rows sit mid-list in the
    slash menu, ahead of Code and Table; "AI Assistant" is the second Settings section. One switch ("Hide AI
    features") removes most of it, but it is off, and it does not touch the Tasks page.
13. **IT is one of three first-run choices,** and 13 of the type gallery's 26 entries are IT (Host, Container,
    Runbook, Incident…). Nothing is offered for a personal life beyond Meeting, Person, Project, Book and a few
    media types: no Journal, Recipe, Idea, Goal, Trip.
14. **Settings:** four of seventeen sections are AI, agents, work or integrations (Jira site, alert folder, Desk
    sync, MCP servers), against five about writing. A default reads `activityName: 'Gene'`.
15. **The words are a database's:** "Object Types", "Pick an object type", "Delete object", "Create an object",
    "Reuse any content", "Queries", "DailyNotes"; about 230 UI strings say "object". The type is "Page", the view is
    "All notes".

## What is already good and must not be lost

The Calendar Day view (daily note inline, today's and overdue tasks, arrow keys); the one-click "Today's note";
Inbox quick add; Tasks > Today's Overdue and Today groups; Ctrl+K (fast, searches text, shows recents); `[[` with
create-in-place, backlinks with context and **unlinked mentions**; tags and `#tag` chips; paste (Markdown, links,
images); a to-do turning into a real Task; focus mode; rename renames the file; Trash with Undo; never writing on
read; the "Hide AI features" switch; tab restore.

## How it happened

The base spec (2026-10-23) is a notes app: daily notes, tasks as "ordinary objects of a task type" with status,
priority and due date, and an assistant that "never writes on its own". Agents (M17-M21) were then placed "at the
top of the sidebar"; the work dashboard (M22-M24) began as a separate page; on 2026-11-08 the plain Tasks page was
retired into it and "All notes" left the sidebar; M28-M30 added the IT starter as a first-run choice. Each step was
reasonable alone. Together they moved the default from "write" to "operate".

## How separable it is

- **AI assistant, agents, MCP gateway:** self-contained, already behind one switch. Saving a note never calls agent
  code.
- **Work dashboard:** self-contained (76 files) except that it *is* the Tasks page; the plain task lists are still
  there as views inside it.
- **Ticket fields on Task and Project:** woven into the type model (added at every load). The hardest piece.
- **Import, synced facts, IT types, the API:** self-contained and off the default path already, apart from the
  first-run choice and the gallery.

Nothing needs deleting to fix the default experience. It needs the default path rebuilt around writing, and the
rest moved behind the user's own choice.
