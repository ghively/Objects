'use strict'
// The window's size, position and maximised state, per device: `<state>/desktop/window.json`.
// It also keeps the last "Window buttons" value and theme the page told the shell, so the next
// launch starts with the right buttons and colours before the page has loaded.

const fs = require('node:fs')
const path = require('node:path')
const { DEFAULT_SIZE, TOP_BAR_HEIGHT } = require('./windowOptions')

const MIN = { width: 200, height: 150 }
/** How much of the top bar must be on a screen for the window to stay where it was. */
const REACHABLE = 120

/** The saved state, or `{}` (no file, a broken file): never an error. */
function loadState(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

/** Writes the state (a temporary file, then a rename). False when it could not be written. */
function saveState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // nothing to clean
    }
    return false
  }
}

/** A Wayland session (Electron runs native Wayland there by default since 38), unless X11 is forced. */
function isWayland(env, argv) {
  const forced = (argv || []).map((a) => /^--ozone-platform=(.+)$/.exec(String(a))).find(Boolean)
  if (forced) return forced[1] === 'wayland'
  return env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY)
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/**
 * Where the window opens: the saved place when its top bar is still on a screen
 * (`workAreas`: every display's work area), else left to the system to place; never larger
 * than the screen it opens on. On Wayland a window cannot be placed (`setPosition` and the
 * `x`/`y` options do nothing there), so only the size and maximised state come back.
 */
function placeOnDisplays(state, workAreas, { wayland = false } = {}) {
  const s = state || {}
  const good = (v, min) => Number.isFinite(v) && v >= min
  let width = good(s.width, MIN.width) ? Math.round(s.width) : DEFAULT_SIZE.width
  let height = good(s.height, MIN.height) ? Math.round(s.height) : DEFAULT_SIZE.height
  const maximized = s.maximized === true
  const areas = Array.isArray(workAreas) ? workAreas : []

  let home = null
  if (!wayland && Number.isFinite(s.x) && Number.isFinite(s.y)) {
    home = areas.find((a) =>
      s.y >= a.y && s.y + TOP_BAR_HEIGHT <= a.y + a.height &&
      overlap(s.x, s.x + width, a.x, a.x + a.width) >= Math.min(REACHABLE, width)) || null
  }
  const screen = home || areas[0]
  if (screen) {
    width = Math.min(width, screen.width)
    height = Math.min(height, screen.height)
  }
  return home ? { x: Math.round(s.x), y: Math.round(s.y), width, height, maximized } : { width, height, maximized }
}

module.exports = { loadState, saveState, placeOnDisplays, isWayland, DEFAULT_SIZE }
