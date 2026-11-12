# Object's desktop window

A small Electron shell that shows Object in a frameless window. `objectapp` (Python) is the
parent: it starts the server, starts this shell with its launch JSON in the environment
(`OBJECT_DESKTOP_LAUNCH`, never on the command line, where other local users could read the
one-time link in the process list; the shell removes it as it reads it), and stops the server
when the shell exits. The shell never starts Python and is not meant to be run by hand.

- Install once: `cd desktop && npm ci` (Electron is pinned to one exact version; the install
  also fetches its binary). Then `uv run objectapp --space <folder>` uses it.
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
maximise and minimise checks are left out. With `xdotool` installed it also drags the window's
edges and right-clicks with real pointer events. Environment: `OBJECT_E2E_PYTHON` (a Python that has
Object's dependencies; default `uv run python`), `OBJECT_E2E_PLAYWRIGHT` (the `playwright`
package's folder when it is not installed beside the front end), `OBJECT_E2E_PORT` (default
8891; the two ports 100 and 200 above it are used for debugging), `OBJECT_E2E_SHOTS` (a folder
for two screenshots).
