# UI reference: Capacities look and feel

The target for the rebuild. Screenshots are from Capacities 1.71 (web, dark mode), taken 2026-10-23.
Colours below are sampled from the screenshot pixels. Sizes are read off the screenshots, so treat them as ±2px.

| File | Shows |
|---|---|
| `01-calendar-day.png` | App shell, sidebar, calendar Day view, mini-month right panel |
| `02-calendar-three-days.png` | Calendar Three-days view, sidebar panel collapsed state of right panel |
| `03-settings-account.png` | Settings modal (grouped left nav + content) |
| `04-collection-weblinks-cards.png` | Object-type page, card (wall) layout, filter popover |
| `05-object-peek-person.png` | Object opened as a large "peek" modal with property panel |
| `06-object-context-menu.png` | Object `…` menu |

> `03-settings-account.png` shows a personal email address. Keep this folder out of anything shared.

## Theme tokens (dark)

| Token | Value | Used for |
|---|---|---|
| `--bg-app` | `#0d0c10` | Window background, sidebar, top bar |
| `--bg-panel` | `#151418` | Main content panel, right panel, peek modal (body and side panel; a 1px `--border` rule between them, 16px corner radius) |
| `--bg-raised` | `#1a1a1d` | Cards, menus, buttons, inputs |
| `--bg-raised-2` | `#212024` | Inline code, pager pill (not the peek body: sampled #151418 in 05) |
| Card edge | `#27262b` | Main card border (`color-mix(border-front 80%, bg-back)`) |
| `--bg-hover` | `#232326` | Sidebar active row, chips, hover |
| `--bg-hover-2` | `#28272b` | Menu row hover |
| `--border` | `#2d2c31` | Dividers, panel separators, count pill |
| `--text` | ~`#f4f4f5` | Primary text |
| `--text-muted` | ~`#9a9aa0` | Secondary text ("Week 43", "No pinned content", empty-state subtitles) |
| `--accent-today` | `#ff0000` (fill), red text on dark-red pill | Today marker |
| `--danger` | `#cd1e46` | Delete actions |
| Primary button | `#e8e7e6` bg, dark text | "New" split button on type pages |

Fonts are Inter throughout, with base text at 15px. Weekday labels are coloured per day (Thu orange, Fri blue, Sat magenta).

## App shell

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [💡 CPI ⌃]  [⊟]   ‹ ›  [📅 Calendar] [+]                              [◫] │  top bar on --bg-app
├──────────────┬──────────────────────────────────────────────┬─────────────┤
│ [+ New    ][🔍]│                                              │             │
│ 📅 Calendar   │      main panel (--bg-panel, rounded ~12px,  │ right panel │
│ ✓ Tasks  🚀   │      inset from window edge, own scroll)     │ (toggle ◫)  │
│ ✧ Explore 🚀  │                                              │             │
│               │                                              │             │
│ ☆ In Progress │                                              │             │
│   No pinned…  │                                              │             │
│ Pinned        │                                              │             │
│   No pinned…  │                                              │             │
│ Object Types  │                                              │             │
│ ▣ Meetings    │                                              │             │
│ ▣ Prompts …   │                                              │             │
│ 👤 ⚙ ☀    ↗  │                                              │             │
└──────────────┴──────────────────────────────────────────────┴─────────────┘
```

- **Top bar:** a space switcher (lightbulb icon, space name, up/down chevron), a sidebar-collapse button, back/forward, then **tabs** (icon + title) and a `+` new-tab button. A right-panel toggle sits at the far right.
- **Sidebar (~330px):** a full-width **+ New** button with a square **search** button beside it. Below that:
  - fixed navigation (Calendar, Tasks, Explore; Pro features carry a small purple rocket badge)
  - **In Progress** (a pinned saved query, star icon)
  - **Pinned**
  - **Object Types**, a scrollable list where each type has a coloured rounded-square icon (Iconify)
  - footer icons: profile, settings, theme toggle, and share on the right.
  Section headers are small and muted; empty sections show italic muted "No pinned content".
- **Main panel:** inset card with a rounded corner and its own scroll; it's the only surface with a visible frame.

## Calendar (01, 02)

- A centred **segmented control** (Month · Week · Three days · Day) and on the right a **‹ Today ›** pager and a "show mini calendar" toggle.
- **Day header:** a coloured weekday name, a red **Today** pill, a huge bold date ("October 23, 2026", ~36px) and a muted "Week 43".
- **Quick-create chips** for the main types (Task, Meeting, Project), each with its type icon.
- **Filter tabs:** All · Daily note · Tasks · Created Today (the active one has a filled pill).
- **Stacked sections** (Daily note, Tasks, Created Today). Each has a bold heading on the left and a small toolbar on the right (layout ▾, filter, +, count). Empty states are a centred bold line plus a muted subtitle.
- **Daily-note slot:** an outlined "+ Daily Note" button until the note exists.
- **Three-days view:** columns separated by thin vertical dividers, each with its own day header.
- **Right panel:** a month picker (Month ▾ Year ▾ with ‹ › buttons) above a 7-column grid. Today is a filled red rounded square, and days outside the month are muted.

## Object-type / collection page (04)

- **Header:** type icon tile, title (~24px bold), and on the right search, `…`, and a **New** split button (light primary, with a ▾ for templates).
- **View tabs:** Overview · All (icon + label pill, active one filled).
- **Toolbar (right):** count pill ("6"), filter, sort, group, layout picker ▾, view settings.
- **Filter popover:** "where" followed by **+ Filter** and **+ Filter group**.
- **Card (wall) layout:** 5 columns at this width. Each card has:
  - a type label (icon + "Weblink") at the top
  - a large image/preview area
  - a bold title (2 lines max)
  - a meta row (favicon + domain + copy button)
  - a tag row (tag icon + coloured pills, truncated)
  Cards are `--bg-raised` with a ~12px radius and no visible border.

## Object view, peek modal (05, 06)

- Opening an object from a list shows a **large modal (peek)** over the page, ~1240×850, rounded.
  - **Left property panel** (~370px, `--bg-panel`): each property is an icon + label row, the value or muted "Empty" underneath, thin dividers between them, and a faint "+ Add Property" at the end.
  - **Main body:** a panel-toggle button at the top left; `…` and expand/fullscreen at the top right.
  - **Type chip:** coloured per type (Person is a brown/orange tint `#553025`), followed by a **⇆ Collections** chip.
  - **Title row:** icon (emoji) plus a huge bold title (~36px), then a muted "Tags" field.
  - **Body:** rich text at ~17px with comfortable line height, emoji headings, nested bullets and quote rails.
  - **Heading minimap** on the right edge: short horizontal dashes, with the active heading longer and brighter.
  - **Pager** at the bottom right ("6 / 6 ‹ ›") steps through the list the peek was opened from.
- **`…` menu:** grouped with dividers. Every row is icon + label, with a right-aligned shortcut or ▸ submenu chevron.
  - Open ▸, Find in Page (Ctrl F), Customize ▸
  - Use Template ▸, Pin to Sidebar ▸
  - Change Type ▸, Object Type Settings
  - Share, Present (Ctrl Alt P), Export (Ctrl E), Import (Ctrl I)
  - Version History (Pro), Text Stats ▸
  - Copy ▸, Duplicate, Merge Into Object ▸, **Delete Object** (red, Ctrl ⌫)

## Settings (03)

- A modal with a **left nav** (~340px): a search field, then groups **Account** (Account, Password & Authentication, Subscription & Billing), **General** (Appearance, AI Assistant, Editor, Language, Date & Time, Offline & Sync, Import Content, Full Export), **Space** (Space Settings, Object Types, Task management) and **Integrations**. Badges ("Upgrade", "Tip") sit right-aligned.
- **Content:** an icon tile + title + description header, then sections each with a bold title, muted help text, rounded inputs (`--bg-raised`, 1px border) and an outlined secondary button.
- For the offline rebuild, drop the Account and Subscription groups and replace Offline & Sync with "Vault folder".

## Still unseen (fill in later if needed)

Light mode; table, list and kanban layouts; the command palette (Ctrl K); the full-page object view (not peek); the graph; the whiteboard; the type editor (Object Type Settings).
