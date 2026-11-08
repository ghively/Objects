# Object front end

React 19 and TypeScript, built with Vite and styled with Tailwind v4 and shadcn/ui. The Python back end serves
the built app from `dist/`.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install exactly what `package-lock.json` pins (use this, not `npm install`) |
| `npm run dev` | Vite dev server; `/api` is proxied to `http://127.0.0.1:8790`, so start the back end too |
| `npx vitest run` | The test suite (Vitest and Testing Library, jsdom) |
| `npx tsc -b --noEmit` | Type-check |
| `npx oxlint` | Lint |
| `npm run build` | Type-check and build to `dist/` |

## Where things are

| Folder | What is in it |
|---|---|
| `src/api/` | The HTTP client and the change stream (Server-Sent Events) |
| `src/editor/` | The Tiptap block editor and its Markdown round trip (`document.ts`, `preserve.ts`): a block you didn't edit keeps its bytes |
| `src/object/`, `src/properties/` | The object page, the property panel and every property cell |
| `src/views/` | The layouts (list, gallery, wall, table, kanban, calendar, timeline, chart, embed), filters, sorts and grouping |
| `src/calendar/`, `src/tasks/` | Daily notes, the calendar and the Tasks page |
| `src/search/`, `src/palette/`, `src/references/`, `src/graph/` | Search, the command palette, backlinks and unlinked mentions, the graph |
| `src/whiteboard/` | Whiteboards (xyflow) and pen ink (perfect-freehand) |
| `src/ai/`, `src/agents/`, `src/mcp/` | The AI chat panel, agent pages, MCP servers |
| `src/work/` | The Work section |
| `src/import/` | Import dialogs and the agent import workflow |
| `src/shell/`, `src/nav/`, `src/settings/`, `src/theme/` | The window, sidebar, tabs, settings and themes |

Fonts (Inter) and icons (Phosphor and VS Code icons through Iconify) are bundled; nothing is fetched at runtime.
`src/noNetwork.m8.test.ts` keeps it that way.
