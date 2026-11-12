'use strict'
// The BrowserWindow options per system (Electron 45.3.0; option names from its electron.d.ts).
//
// - Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay`: the system's own minimise, maximise
//   (with snap layouts) and close, drawn over the top bar's right end in the theme's colours.
// - macOS: `titleBarStyle: 'hiddenInset'`: the traffic lights sit in the top bar's left end.
// - Linux: `frame: false`: the page draws the buttons (or none: see controls.js).
// - `--frame system`: the system's ordinary frame everywhere.

/** The app's top bar (`frontend/src/shell/TopBar.tsx`, `h-[42px]`). */
const TOP_BAR_HEIGHT = 42

/**
 * macOS: one traffic-light button. Electron places the buttons by their frame
 * (`trafficLightPosition` is the first frame's top left; it centres them by the frame's height
 * when it lays them out itself), and AppKit's standard window button frame is 14x16 points with
 * the 12pt circle inside, 6 points apart. Not run here: macOS cannot be run in this repository's
 * checks, so this is from the documentation and the system's standard sizes.
 */
const TRAFFIC_LIGHT_BUTTON = { width: 14, height: 16, gap: 6 }

/**
 * macOS: where the traffic lights are put, and the room (px from the left edge) they take.
 * `y` centres them in the top bar: (42 - 16) / 2 = 13. `reserve` is what the page keeps free
 * (`frontend/src/desktop/desktop.css`, `padding-left: 78px`): they end at 14 + 3x14 + 2x6 = 68.
 */
const TRAFFIC_LIGHTS = { x: 14, y: (TOP_BAR_HEIGHT - TRAFFIC_LIGHT_BUTTON.height) / 2, reserve: 78 }

/**
 * Until the page has ever said its theme: the app's default (dark) theme's `--bg-app` and
 * `--text` (`frontend/src/theme/tokens.css`). After that the last theme told is remembered.
 */
const DEFAULT_THEME = { mode: 'dark', background: '#09090b', foreground: '#f4f4f5' }

const DEFAULT_SIZE = { width: 1440, height: 900 }
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** The page's `setTheme` value, or null when it is not a mode and two hex colours. */
function cleanTheme(t) {
  if (t === null || typeof t !== 'object') return null
  const { mode, background, foreground } = t
  if (mode !== 'light' && mode !== 'dark') return null
  if (typeof background !== 'string' || !HEX.test(background)) return null
  if (typeof foreground !== 'string' || !HEX.test(foreground)) return null
  return { mode, background, foreground }
}

/** Windows: the caption buttons' colours and height (`titleBarOverlay` / `setTitleBarOverlay`). */
function overlayFor(theme) {
  const t = cleanTheme(theme) || DEFAULT_THEME
  return { color: t.background, symbolColor: t.foreground, height: TOP_BAR_HEIGHT }
}

/**
 * The main window. `state`: `{x?, y?, width?, height?}` from windowState.placeOnDisplays.
 * `frame`: 'hidden' (default) or 'system'.
 */
function windowOptions(platform, theme, state, frame = 'hidden') {
  const t = cleanTheme(theme) || DEFAULT_THEME
  const s = state || {}
  const options = {
    title: 'Object',
    width: Number.isFinite(s.width) ? s.width : DEFAULT_SIZE.width,
    height: Number.isFinite(s.height) ? s.height : DEFAULT_SIZE.height,
    backgroundColor: t.background,
    autoHideMenuBar: true,
    show: false,
  }
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
    options.x = s.x
    options.y = s.y
  }
  if (frame === 'system') {
    options.frame = true
  } else if (platform === 'win32') {
    options.titleBarStyle = 'hidden'
    options.titleBarOverlay = overlayFor(t)
  } else if (platform === 'darwin') {
    options.titleBarStyle = 'hiddenInset'
    options.trafficLightPosition = { x: TRAFFIC_LIGHTS.x, y: TRAFFIC_LIGHTS.y }
  } else {
    options.frame = false
  }
  return options
}

/** The keep-on-top window (M23): it has no top bar of ours, so it keeps the system's frame. */
function focusWindowOptions(platform, theme) {
  const t = cleanTheme(theme) || DEFAULT_THEME
  return {
    title: 'Object focus',
    width: 360,
    height: 470,
    alwaysOnTop: true,
    backgroundColor: t.background,
    autoHideMenuBar: true,
    show: false,
  }
}

/** Safe by default: the page has no Node; the preload exposes only the bridge. */
function webPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: true,
  }
}

module.exports = {
  TOP_BAR_HEIGHT, TRAFFIC_LIGHT_BUTTON, TRAFFIC_LIGHTS, DEFAULT_THEME, DEFAULT_SIZE, cleanTheme, overlayFor, windowOptions,
  focusWindowOptions, webPreferences,
}
