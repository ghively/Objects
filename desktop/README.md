# Object's desktop window

A small Electron shell that shows Object in a frameless window. `objectapp` (Python) is the
parent: it starts the server, starts this shell with its launch JSON in the environment
(`OBJECT_DESKTOP_LAUNCH`, never on the command line, where other local users could read the
one-time link in the process list; the shell removes it as it reads it), and stops the server
when the shell exits. The shell never starts Python and is not meant to be run by hand.

`objectapp` talks to the shell on its stdin, one JSON line at a time (`lib/stdinLines.js`):
`{"open": "<one-time url>", "kind": "focus"}` opens Keep on top's window, and `{"kind": "quit"}`
(written when `objectapp` is stopped: Ctrl-C, SIGTERM, SIGHUP, a closed console) closes every
window the way a person's close does, so the page saves first. `objectapp` keeps the pipe open
for the shell's whole life, so the end of stdin means it is gone: the shell then closes the same
way. (An end that comes before the window is ready is ignored: that is a stdin that was never
connected, not `objectapp` going.)

- Install once: `cd desktop && npm ci` (Electron is pinned to one exact version; the install
  also fetches its binary). Then `uv run objectapp --space <folder>` uses it.
- Spell check follows the device setting "Spellcheck language" (the page tells the shell the
  tag; `lib/spellcheck.js` picks the dictionary: the exact language, else the same language,
  else the system's). On Windows and Linux Chromium downloads a language's dictionary from its
  vendor's server the first time it is used; on macOS the system's own spellchecker is used.
- Unit tests (no display needed): `npm test`.
- `main.js` is the wiring; everything with a decision in it is a small module in `lib/` with a
  test beside it in `test/`. `preload.js` is the bridge the page sees (`window.objectDesktop`).

## The end-to-end check

`test/e2e/shell.e2e.js` starts the real back end on a new empty space through
`objectapp --window electron` and drives the real window (Playwright over the debugging port).
It is not part of `npm test`: it needs a display, the built front end (`frontend/dist`) and
Python. From the repository root:

```sh
cd frontend && npm run build && cd ..
node desktop/test/e2e/shell.e2e.js                 # on a desktop
xvfb-run -a -s "-screen 0 1920x1080x24" node desktop/test/e2e/shell.e2e.js   # without one (Linux)
```

Under `xvfb-run` install a window manager first (`openbox`; the script starts it), or the
maximise and minimise checks are left out. With `xdotool` installed it also uses real pointer
and key events: it drags the window's edges and the top bar (and checks a press on a bar button
or the space switcher does not move it), double-clicks the bar to maximise and restore, clicks
Minimize, Maximize, Restore and the corner's Close, right-clicks, picks each "Window buttons"
choice in Settings (and sees "Hide" honoured on the next launch), types a title and three
sentences and closes at once with the page's own before-close handler, and types a property
before the window manager's close (Alt+F4) and before SIGTERM to `objectapp` (the shell and
`objectapp` exit, the port is free). It also checks the theme reaches the shell on load
and on a change, "Spellcheck language" reaches its spellchecker (with the dictionary download
pointed at nothing), that no command line holds the one-time link, and that links reach the
default browser only on a person's click: not when the page follows one by itself, not from an
embedded page of another site (served on the port above the app's), and yes for a click on a
Web link block in a note and on a button that calls `window.open`. Environment: `OBJECT_E2E_PYTHON` (a Python that has
Object's dependencies; default `uv run python`), `OBJECT_E2E_PLAYWRIGHT` (the `playwright`
package's folder when it is not installed beside the front end), `OBJECT_E2E_PORT` (default
8891; the port 1 above it serves the other site, and the two ports 100 and 200 above it are used
for debugging), `OBJECT_E2E_SHOTS` (a folder for two screenshots).
