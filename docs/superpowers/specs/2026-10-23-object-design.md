# Object: design

Status: approved and implemented (M1–M9 built by 2026-10-28; later milestones M10–M27 built by 2026-11-07 under their own specs and plans, see `plans/remaining-work.md`) · written 2026-10-23 (third revision), amended per milestone where marked
Working name: **Object**.

## 1. What we're building

**A local, Markdown-backed notes app.** It's a new desktop app with its own object model (objects, types, properties, collections, tags, daily notes, tasks, queries, whiteboards) that stores everything in a local Markdown folder, with no cloud. Gene can change any of it later.

Two sources define it:
1. **The UI:** the behaviour catalog (`docs/behavior-catalog.md`) and the look and feel in §5 give every screen, menu label, option name and design token.
2. **The data model:** §3 below. Everything the app lets you configure is in scope, not only what an export shows.

It's a new code base, written from scratch.

## 2. Scope

**In:**
- **Objects and types:** objects, object types, properties, collections, tags, daily notes, tasks, queries, the calendar, the graph, whiteboards, search, backlinks, templates, the command palette, tabs and side panels, and settings that apply locally.
- **Freehand pen drawing** on whiteboards with Wacom pressure. This is Gene's addition.
- **AI assistant** (added 2026-11-02, M10): chat, block and tag helpers, run through the user's Claude Code CLI; it never writes on its own. Plan: `plans/2026-11-02-m10-ai-assistant.md`.

**Out:**
- anything that only exists because of the cloud: accounts, login, billing and Pro gating, sync, sharing and publishing, mobile
- telemetry

**Later (wanted, lower priority, each needs its own spec change):** integrations (calendar feeds, task actions, email, Readwise, Kindle, Telegram, WhatsApp, Raycast). The local API and MCP server (M11) are built.

Every feature is simply available; nothing is gated behind a paid tier.

## 3. Data model

| Concept | Must support |
|---|---|
| **Object type** (Structure) | name, plural name, icon, colour, description; ordered property definitions; layout `profile` / `indexCard` / `encyclopedia`, wide mode, cover crop; how objects of the type render elsewhere (inline, small card, wide card, embed, page) with per-view settings; default view; templates; calendar options |
| **Property kinds** | text, rich text block, simple table, number (formats: number, currency, percentage, progress; decimals, thousands separator), checkbox, URL, date and date+time (with ranges, `time`/`day` resolution, constraints), relation to objects (single or multiple, limited to chosen types, fixed set, property syncing), label (single or multiple, options with colour and icon, can act as **status** with categories not-started / in-progress / blocked / done), blocks. Per property: icon, description, visibility (always / hide when empty / hidden), searchable |
| **System properties** | title, icon, description, aliases, tags, type, collections, created, last updated, backlinks |
| **Collections** (Databases) | named sets of objects of one or more types, an object can be in several; their own views, pinned items, templates, dashboard sections |
| **Tags** | objects in their own right: name, icon, colour, page body |
| **Queries** | saved filter/sort/group definitions with a view |
| **Views** | list, grid, wall (cards), table, embed, kanban, gallery. Table: column widths, wrap, pinned column, hidden columns, column calculations. Group-by with group order, hide or collapse groups, hide empty groups. Filters with filter groups. Sorts |
| **Blocks** (note body) | text with heading levels H1–H4 and "small"; bullet, numbered, alphabetical and roman lists; to-dos; toggles; quotes (normal / standout); text and background colours; alignment; nested blocks; code (language, line wrap, Markdown and Mermaid preview); math (KaTeX); horizontal line; grid/columns; group; simple table (header row and column); embedded objects with their own view settings; media (image, PDF, audio, video, file, web link) |
| **Daily notes** | one per date, a "reviewed" flag, day/week/three-day/month calendar |
| **Tasks** | ordinary objects of a task type: status label, priority low/medium/high, due date, **recurrence** (every N day/week/month/year, by due date or completion date), reminders |
| **Whiteboards** | grid of 30 px; blocks (text and objects), 12 shapes, frames, points, logic-circuit gates; connectors straight/cornered/curved, solid/dashed/dotted, end markers none/arrow/dot/double; plus our freehand ink |

During implementation the builder takes each feature's **behaviour and options** from this table and the behaviour catalog.

## 4. How it's stored (Markdown folder)

A **space** is a folder; the app can hold several spaces and switch between them. The layout is plain Markdown files in type folders, plus an app-data folder:

```
My Space/
  .object/                     app data, readable JSON/YAML, safe to version
    space.json                 space name, icon, settings
    types/<type>.json          one object-type definition each (properties, card/link view settings, templates…)
    views/<typeId>.json        a type page's saved views (Overview, All, section tabs)   [amended M3]
    collections/<id>.json      collection definitions and their views                   [amended M3]
    queries/<id>.json          saved queries                                            [amended M3]
    ui.json                    sidebar order, pinned items, custom sidebar sections, open tabs
  .object-cache/               search index (derived, rebuildable)
  Tasks/Standalone GUI.md      one object = one Markdown file in its type's folder
  DailyNotes/2026-10-23.md
  Tags/Networking.md
  Whiteboards/Network map.md   + Network map.whiteboard.json (+ ink SVGs)
  Attachments/…                images, PDFs and files
```

*Amended for M3 (2026-10-26):* collections and queries are stored by a stable `<id>` (the slug of the name at creation, never changed on rename), not by name, so renames don't move files or break references. A type page's views live in `views/<typeId>.json`, beside the type file rather than inside it, so a view change never bumps the type's revision. See `docs/superpowers/plans/2026-10-26-m3-views-collections-queries.md`.

**An object file** follows the export's shape, plus the fields the export loses:

```markdown
---
id: 3f1c9a…                    # stable id, so renames don't break links
type: Task
title: Standalone GUI
icon: ph-desktop               # or an emoji
createdAt: 2026-10-23T16:20:00Z
lastUpdated: 2026-10-23T16:41:00Z
tags: [GUI]
collections: [Tooling]
status: Not Started            # label → option name
priority: Medium
deadline: 2026-10-30
project: "[[Second brain]]"    # relation → wikilink(s)
---

# Standalone GUI

Body = the object's blocks, as Markdown.
```

**Rules:**
- **Body blocks** that plain Markdown can express are written as plain Markdown. Block options Markdown can't express (toggles, colours, columns, standout quotes, embed view settings, alphabetical/roman lists) are kept with a small inline annotation, so the file still reads cleanly in any editor. The annotation syntax is the builder's choice.
- **Links** are `[[Title]]`. Renaming an object renames its file and updates the links to it.
- **Files outside the app:** if a file is edited elsewhere, the app picks up the change. Saving never rewrites parts of a file that weren't edited.

## 5. Look and feel

- Match the behaviour catalog and the design tokens: Inter at a 15px base, Object's dark palette, radii, soft layered shadows, the Phosphor icons. Light mode is included.
- **Interactions to copy:**
  - the peek modal with its pager
  - the `…` menus and their groupings
  - the slash menu and drag handles in the editor
  - the property panel and "+ Add Property"
  - the Ctrl+K command palette
  - tabs with breadcrumbs
  - the three-area side panel
  - the calendar views and mini month
  - hover states and keyboard shortcuts
- **The test:** Gene walks through the behaviour catalog in the app, and every screen should match it.

## 6. How it's built (my call)

- **Front end:** React + TypeScript + Tailwind + shadcn/ui (restyled to the app's own design tokens). Tiptap for the block editor. A force-graph library for the graph. A canvas library for whiteboards, with `perfect-freehand` for pen ink.
- **Back end:** a small local Python service on `127.0.0.1` that reads and writes the space folder and keeps a SQLite search index.
- **Window:** its own app window (pywebview). Runs with one command; an installer comes later.
- **Order:** built and shown in milestones, roughly:
  1. shell + objects + editor
  2. types and properties
  3. views and collections
  4. calendar, daily notes and tasks
  5. search, graph, backlinks
  6. whiteboards and pen
  7. polish against the behaviour catalog
  Gene sees each one running before the next starts.

## 7. Done when

1. Every feature in §3 works against a local space folder, with no network access needed (the AI assistant, M10, needs the user's Claude Code and its own network access).
2. A test space built from a copy of Gene's CPI export opens and behaves like his CPI space did. The copy stays outside the repo, because it holds work data.
3. Files stay readable Markdown. Editing one thing changes only that thing in the file.
4. Against the behaviour catalog, Gene judges the look and feel right.
5. The Wacom pen draws pressure-sensitive ink on whiteboards.
