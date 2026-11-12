# M33: the frameless desktop window, and the choices M32 left

Gene, 2026-11-12: decide the twelve choices M32 left ("I'll just accept your recommendations as long as those
recommendations are additive and not destructive"), judged against how three widely used notes apps behave; and
"when running natively on the desktop [the window is] frameless and … integrates properly with the operating
system, whether that be Windows, Macintosh or Linux", with the technology left to our judgement.

Two parts, built together by file ownership, one review, one fix pass, the gate.

## Part 1: the desktop window

### The decision: an Electron shell, beside the pywebview window (which stays)

The three apps Gene named all ship as Electron apps, and it is the only option here that gives a frameless window
with the system's own controls on all three systems:

| | pywebview frameless | Tauri | Electron |
|---|---|---|---|
| Windows: native caption buttons, snap layouts, resize borders | no (drawn by us, no snap) | partly (plugin) | yes (`titleBarOverlay`) |
| macOS: traffic lights inset in our own bar | no | yes | yes (`hiddenInset`) |
| Linux: frameless, resize, Wayland | undecorated GTK window | yes | yes |
| Same engine on every system (what the tests drive) | no (WebView2 / WKWebView / WebKitGTK) | no | yes (Chromium) |
| New toolchain | none | Rust | Node, already used for the front end |

Additive: `uv run objectapp` keeps working exactly as today. When the shell is installed it is used; when it is not
(or it fails to start), the pywebview window opens as before. `--browser` is unchanged.

### How it runs

- `desktop/` holds the shell: `package.json` (Electron pinned to an exact version), `main.js`, `preload.js`, small
  modules, tests. Install once: `cd desktop && npm ci`.
- **Python stays the parent.** `objectapp` starts the server as today, then starts the shell as a child process
  with the one-time open link, and stops the server when the shell exits. So every existing launcher entry keeps
  working and nothing in the shell knows how to start Python.
- New option `--frame hidden|system` (default `hidden`; environment `OBJECT_WINDOW_FRAME`): `system` runs the shell
  with the system's ordinary window frame on every platform, for a window manager the frameless window does not
  suit. The bridge then reports `controls: 'none'` and `framed: true`, and the page reserves and draws nothing.
- New option `--window auto|electron|pywebview` (default `auto`: the shell when `desktop/node_modules/electron`
  is there, else pywebview; `electron` fails with a plain message when it is not installed; `pywebview` forces
  the old window). Environment `OBJECT_WINDOW` gives the same choice.
- Python hands the shell, as one JSON object in the child's environment (`OBJECT_DESKTOP_LAUNCH`; never on its
  command line, where other local users could read the link in the process list; the shell removes the variable
  as it reads it, so nothing it starts inherits it): `url` (the one-time `/_open?code=…`
  link), `origin` (`http://127.0.0.1:<port>`), `stateDir`, `icon` (the device setting "App icon" file, or null),
  `title` ("Object").
- **Keep on top** (M23): `windowhost.set_opener` writes one JSON line to the shell's stdin,
  `{"open": "<one-time url>", "kind": "focus"}`; the shell opens the 360x470 always-on-top window ("Object
  focus"). Each window gets its own one-time link, as now.
- **Closing loses nothing.** On the window's close the shell asks the page to save first (`before-close`), waits
  for its answer or 3 seconds, then closes; only when the shell has exited does Python stop the server. (With
  pywebview the server stops as the window closes; that limit goes away in the shell.)

### The window on each system

- **Windows:** `titleBarStyle: 'hidden'` with `titleBarOverlay` (the system's minimise, maximise with snap
  layouts, close), coloured from the app's theme; the top bar leaves that corner free.
- **macOS:** `titleBarStyle: 'hiddenInset'`; the traffic lights sit in the top bar, which leaves room for them on
  the left (not in full screen). A standard application menu (App, Edit, View, Window) so the system's keys work.
- **Linux:** `frame: false`. The top bar draws minimise, maximise/restore and close at its right end. On a tiling
  compositor, where windows have no buttons, they are left out: `XDG_CURRENT_DESKTOP` / `XDG_SESSION_DESKTOP`
  naming Hyprland, sway, i3, river, niri, bspwm, dwm, qtile, xmonad or awesome. A device setting overrides it:
  Settings > Appearance > "Window buttons": "Automatic" (default), "Show", "Hide" (key `windowButtons`:
  `auto`|`show`|`hide`; shown only inside the shell on Linux). Native Wayland where the session is Wayland.
- **Everywhere:** the top bar (the row with the sidebar toggle, back/forward and the tabs) is the drag region;
  its buttons, tabs and fields stay clickable; a double click on the free part maximises (the system's own
  behaviour where it has one). The window remembers its size, position and maximised state per device
  (`<state>/desktop/window.json`), and comes back on a screen that still exists.

### Fitting into the system

- One window per launch and the app's name and icon in the taskbar, dock or launcher (`AppUserModelID`
  `com.objectapp.Object` on Windows; the "App icon" device setting is used).
- Links to other sites open in the default browser; the window only ever shows the app's own origin.
- A right click in text gives Cut / Copy / Paste / Select all and spelling suggestions where the app has no menu
  of its own. Spell check is on.
- The system's light or dark follows the app's theme (the Windows button colours too), told by the page.
- Downloads (exports) go through the system's save dialog.
- Web storage lives in `<state>/desktop` (kept between launches); the launch key stays a session cookie.
- Notifications (reminders), clipboard and the microphone (audio notes) are allowed for the app's own origin;
  every other permission request is refused.
- Safe by default: `contextIsolation`, `sandbox`, no Node in the page; the preload exposes only the bridge below.
- `scripts/install-launcher.py`: writes a launcher entry for the current user (Linux `.desktop`; Windows a Start
  menu shortcut; macOS a `.command` file), pointing at `uv run objectapp --space <folder>`. Run by hand, never
  by the app.

Not in M33 (said plainly in the acceptance file): installers that bundle Python (an `.exe`, `.dmg` or AppImage
that needs neither `uv` nor Node). The shell runs from the repository, as the app does today.

### Contract: the bridge (`window.objectDesktop`, set by `desktop/preload.js`; absent in a browser and in pywebview)

```ts
interface ObjectDesktop {
  platform: 'win32' | 'darwin' | 'linux'
  /** Where the window's own controls are. 'overlay': the system draws them at the top right (Windows);
   *  'traffic': at the top left (macOS); 'custom': the page draws them (Linux); 'none': no buttons. */
  controls: 'overlay' | 'traffic' | 'custom' | 'none'
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  isFullScreen(): Promise<boolean>
  /** Calls back when maximised or full screen changes; returns an unsubscribe. */
  onWindowState(cb: (s: { maximized: boolean; fullScreen: boolean }) => void): () => void
  /** The page's theme, so the system parts match: mode and the top bar's colours as CSS hex. */
  setTheme(t: { mode: 'light' | 'dark'; background: string; foreground: string }): void
  /** The shell is about to close the window: save, then resolve. One handler; returns an unsubscribe. */
  onBeforeClose(handler: () => Promise<void>): () => void
  /** True when the shell runs with the system's ordinary frame (`--frame system`): `controls` is then 'none'. */
  framed: boolean
  /** Linux only: apply the "Window buttons" setting now ('auto' | 'show' | 'hide'); resolves the controls
   *  now in force. */
  setWindowButtons(v: 'auto' | 'show' | 'hide'): Promise<'custom' | 'none'>
  /** The device setting "Spellcheck language" (a tag, or null): Electron's spellchecker does not follow
   *  `<html lang>`. The shell picks the offered dictionary (exact, else the same language, else the system's);
   *  a no-op on macOS. (Added when the two halves were put together.) */
  setSpellCheckLanguage(tag: string | null): void
}
```

Front end: `frontend/src/desktop/bridge.ts` (`desktop()` returns the bridge or null; types as above),
`desktop/WindowControls.tsx`, `desktop/useWindowChrome.ts`, `desktop/beforeClose.ts`, `desktop/desktop.css`
(`.app-drag { app-region: drag; -webkit-app-region: drag }`, `.app-no-drag` likewise with `no-drag`, the
per-system padding, all keyed off `controls`). CSS class on `<html>`: `desktop-win32` / `desktop-darwin` / `desktop-linux`, plus
`desktop-fullscreen` while full screen.

## Part 2: the twelve choices

Rule of the pass: additive, nothing a person relies on is taken away, no file is rewritten unless they ask.

| # | Choice | Decision | Lane |
|---|---|---|---|
| 1 | Opening a note leaves the caret nowhere | With a note open and nothing focused, **Enter** puts the caret at the end of the text and **ArrowDown** at its start. A note whose text is empty opens with the caret in the text (there is nothing to read). Nothing is focused by itself on a note with text, so Space and Page Down still scroll and no stray key edits a note. | FE-A |
| 2 | Today's note opens as a pop-over | No change (Gene's request of 2026-11-09). | none |
| 3 | A typed note's pane lists the system rows first | The type's own properties come first, in their own order; the built-in rows (Collections, Description, Created at, Last updated, Tags, Icon, Aliases…) follow. An order the user arranged by hand is kept. Display only: no type file is rewritten. | FE-A |
| 4 | A type made from the gallery lands on its settings | It lands on the type's own page (its list, ready for "New"), with a toast naming it and a "Type settings" action. A type made from scratch still opens its settings. | FE-B |
| 5 | Old notes that open with `# Title` show it twice; imports add it | Imports stop adding the line (a re-run of an earlier import changes nothing because of it). For notes that already have it: Settings > Editor shows, only when there are some, "N notes begin with a heading that repeats their title." with "Remove those headings" (a confirmation; each note keeps its earlier version in history). Nothing is removed without that click, and nothing is hidden on screen. | BE, FE-B |
| 6 | A task with only a deadline sits in Inbox for ever | Also listed where its deadline puts it: under Today's Overdue once the deadline has passed, on its day in Upcoming before that (marked as a deadline). It is no longer in Inbox, which is "no date and no deadline": a task with a deadline has its place. A task with a date is placed by its date, as now; every open task is in exactly one of Today, Upcoming and Inbox. | FE-B |
| 7 | `> ` makes a toggle | Kept as the default (two of the three apps do the same). New: Settings > Editor > "Typing "> " makes": "A toggle" (default), "A quote" (key `greaterThanMakes`: `toggle`\|`quote`). `\| ` still makes a quote either way. | BE, FE-B |
| 8 | Property kinds read "Link", "Link to a type" | No change. | none |
| 9 | "No date" writes `date: null` | "No date" does exactly what clearing the Date in the properties pane does. If that is already so, nothing changes. | FE-B |
| 10 | Quick add ignores past words; the global new task reads no dates | No change: reading past words brings back the misreadings F3 removed, and the global key makes a task page whose title is the person's own words. | none |
| 11 | A mention shows raw `[[…]]`; a line naming the note twice is listed twice | The context reads as text (a link shows its words), and a line is listed once; "Link" links every unlinked mention of the title in that line. Unlinked mentions stay as visible as they are. | FE-A (+BE if the rows come per mention) |
| 12 | Alt+N, Alt+Shift+N in a browser tab | No change. In the desktop shell Ctrl+N and Ctrl+U are free, so both pairs work there. | D1 (check) |

## Contract (names every lane uses)

- Settings (device, `backend/objectapp/settings.py`): `greaterThanMakes` (`"toggle"` default, `"quote"`),
  `windowButtons` (`"auto"` default, `"show"`, `"hide"`). An old settings file without them reads the defaults and
  is not rewritten on read.
- `GET /api/space/title-headings` → `{ "count": N }` (notes whose body's first heading outside a code fence is
  `# <their title>`, by the rule `rename_object` uses). Read-only.
- `POST /api/space/title-headings/remove` → `{ "changed": N }`: removes that one line (and one blank line after
  it) from each such note through the ordinary body write (atomic, CRLF/BOM kept, version history keeps the
  earlier text, `lastUpdated` as any body save). Refused with the space's usual answer when the space is read-only.
- The bridge and the front-end `desktop/` module names above.
- The launch (`OBJECT_DESKTOP_LAUNCH`), the stdin line and `--window` / `OBJECT_WINDOW` above.

## Lanes and file ownership

| Lane | Owns |
|---|---|
| D1 shell | `desktop/**`; `backend/objectapp/__main__.py`, `windowhost.py`, `appicon.py` and their tests; `scripts/install-launcher.py`; README's run section |
| D2 chrome | `frontend/src/desktop/**`; `frontend/src/shell/TopBar.tsx`, `TabStrip.tsx` (the drag region and the room for the controls only), `frontend/src/main.tsx` / `App.tsx` (mounting the chrome and the before-close handler only); `frontend/src/settings/sections/Appearance.tsx` ("Window buttons") |
| FE-A note page | `frontend/src/object/**`, `frontend/src/properties/PropertyPanel*`, `frontend/src/references/**` |
| FE-B tasks, editor, settings | `frontend/src/tasks/**`, `frontend/src/editor/extensions/**`, `frontend/src/settings/sections/Editor.tsx`, `frontend/src/types/CreateTypeDialog*`, `frontend/src/api/client.ts` and `types.ts` (the two new routes, the two settings keys) |
| BE | `backend/**` except D1's three files; `scripts/m33_acceptance.py`; `docs/superpowers/plans/m33-acceptance.md` |

`docs/behavior-catalog.md` is shared: each lane edits the lines for what it changes; the coordinator merges.

## Global constraints

The hard rules stand (never write on read; no typing lost; a property edit changes only its own lines; deletes go
to the Trash; CRLF/BOM; atomic writes; unlinked mentions stay; nothing gated; the server binds 127.0.0.1 only; AI
entries stay where they are). Glossary words on screen. No stored name, key or file renamed. Additive: with no
shell installed and no setting changed, the app behaves as it did at `41857f51` except for choices 1, 3, 4, 6 and 11.

## Review focus

The shell's safety (only the app's origin is ever shown; no Node in the page; the launch key never logged or
written to disk); closing saves first and the server outlives the save; the pywebview path and `--browser`
unchanged; the top bar still works in a browser (no dead drag zones, nothing shifted); the title-headings removal
(exact rule, one line, history kept, nothing else touched); choice 1 never types into a note by itself; unlinked
mentions; the settings keys on an old file.

## Our calls (recorded as they are made)

1. Electron over Tauri and over a frameless pywebview window (the table above).
2. Python stays the parent process; the shell is a child.
3. No bundled installers in M33.
4. The research pass of 2026-11-12 (the three apps' documentation, help centres and release notes; nothing tested
   hands-on) and what it changed: choice 6, a task with only a deadline leaves Inbox (the app this one follows
   treats it as triaged and shows it in Today once due); `--frame system` was added (one of the three offers a
   "native frame" setting for window managers its frameless window does not suit). What it confirmed: two of the
   three make a toggle from `> ` (choice 7); neither of the two that have types or databases lands on settings
   after creating one (choice 4); the one that writes files keeps the key when a date is cleared (choice 9); all
   three desktop apps are Electron with the tabs in a custom top bar. What it could not establish: where the
   caret goes when a note opens in two of the three (the third puts it at the start of the text), so choice 1
   stays the cautious one.
5. Linux draws its own three buttons rather than the overlay Electron also offers there, so they can be left out
   on a tiling compositor.
6. The two halves run together (2026-11-12, Linux under a virtual display): a press on the bar's free part moves the
   window and a double click there maximises and restores; the Linux buttons work by real clicks, also while the
   bar is faded for typing (they stay clickable) and at the window's right end in focus mode; closing makes focus
   leave the field being typed in first, so a property's text is saved by the system's close too; the page's
   `<html>` classes are set before the first paint. macOS's traffic lights go at x 14, y 13: Electron places them
   by the button frame (AppKit's standard 14x16 points, the 12pt circle inside), so (42 - 16) / 2 centres them in
   the 42px bar, and they end at 68px, inside the 78px the page keeps free (a test on the shell's side reads the
   page's CSS so the two stay equal). macOS could not be run here.
7. The spell-check language reaches the shell (`setSpellCheckLanguage`): Electron's spellchecker follows the
   session's languages, not `<html lang>`, so the device setting would otherwise do nothing in the desktop window.
   Spell check stays on; on Windows and Linux Chromium downloads a language's dictionary once from its vendor's
   server, which the setting's help says inside the shell on those two systems and the README says too.
8. The fix pass's desktop calls (2026-11-12). Stopping `objectapp` (Ctrl-C, SIGTERM, SIGHUP) asks the shell to
   quit with one stdin line, `{"kind": "quit"}`, and waits 6 seconds (the page's 3, the shell's 2, one spare)
   before it terminates it; the shell closes on the quit line or on the end of its stdin, but not on an end that
   comes before its window is ready (`objectapp` keeps the pipe open for the shell's life, which a test shows on
   POSIX; on Windows it was not run, and an early end there is then not taken for `objectapp` going, so a
   stdin quirk cannot close the window at launch). On Windows a console control handler keeps the server up
   for up to 4.5 seconds after a closed console, log off or shut down (Windows ends the process at 5), and
   `query-session-end` asks the page to save without holding the shutdown up; neither was run on Windows. A link
   reaches the default browser only within a second of a person's click or key in that window (Electron's
   `input-event`, which a page cannot fake) and only from the app's own page; `window.open` names no frame in
   Electron 45, so its referrer is the sign used (an embedded page of another site that also drops its referrer
   could still open a link within a second of a person's click in the app: the narrow case left). The launcher
   script refuses a path with a control character on every system. A shell that cannot start is reported with
   its last stderr line (without Chromium's prefix, never a line holding a one-time link); its stderr before the
   window is ready is otherwise not shown, and after it is passed on.
