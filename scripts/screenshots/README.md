# README screenshots

The images in `docs/images/` are taken from a **synthetic demo space** ("Studio Notebook": invented people,
projects, books, meetings and tasks, with generated gradient covers). No real data is ever used. Each scene is
captured in light and dark at 2x, then saved as WebP; the README shows the one that matches the reader's
GitHub theme.

## Regenerate them

Run from the repo root, with the front end built (`cd frontend && npm run build`) and Playwright available to
Node (`require('playwright')`). Keep the state, cache and demo folders in a temporary directory, never in the
repo or your own state folder.

```sh
T=$(mktemp -d)
export OBJECT_STATE_DIR=$T/state OBJECT_CACHE_DIR=$T/cache
mkdir -p $T/demo $T/png

# 1. Build the demo space (it is dated around 2026-11-08; change TODAY in the script to move it)
uv run python scripts/screenshots/build_demo.py $T/demo

# 2. Serve it on a spare port
uv run objectapp --space "$T/demo/Studio Notebook" --browser --port 8791 &
export OBJECT_URL=http://127.0.0.1:8791/

# 3. Pick the layouts once (Books and People: Gallery, Projects: Kanban, Meetings: Calendar)
node scripts/screenshots/setup_views.js

# 4. Capture every scene in both themes, then convert
node scripts/screenshots/scenes.js $T/png dark 2
node scripts/screenshots/scenes.js $T/png light 2
uv run python scripts/screenshots/to_webp.py $T/png docs/images
```

`scenes.js` takes scene names after the scale to capture only some of them, for example
`node scripts/screenshots/scenes.js $T/png dark 1 editor kanban` for a quick 1x draft.

| Scene | Shows |
|---|---|
| `object` | A Project page: cover, properties, links, backlinks |
| `editor` | The Welcome page scrolled to its table, formula, Mermaid diagram and code |
| `gallery` | Books in the Gallery layout |
| `kanban` | Projects in the Kanban layout, grouped by Status |
| `tasks` | The Tasks page, Status tab |
| `calendar` | The Calendar's Day view |
| `meetings` | Meetings in the Calendar layout, Month |
| `graph` | The global graph |
| `search` | The Ctrl+K palette searching "atlas" |
| `work` | The Work section's Flow tab |

The scripts drive the UI by its visible labels, so a renamed button or tab means updating `scenes.js`.
