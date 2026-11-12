'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadState, saveState, placeOnDisplays, isWayland, DEFAULT_SIZE } = require('../lib/windowState')

const ONE = [{ x: 0, y: 0, width: 1920, height: 1080 }]
const TWO = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 1280, height: 1024 }]
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'object-desktop-'))

test('saves and loads what the window was', () => {
  const file = path.join(tmp(), 'desktop', 'window.json')
  assert.deepEqual(loadState(file), {})
  const state = {
    x: 10, y: 20, width: 900, height: 600, maximized: true, windowButtons: 'hide',
    theme: { mode: 'dark', background: '#000000', foreground: '#ffffff' },
  }
  assert.equal(saveState(file, state), true)
  assert.deepEqual(loadState(file), state)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['window.json'])
})

test('a broken or strange file is no state, never an error', () => {
  const dir = tmp()
  const file = path.join(dir, 'window.json')
  fs.writeFileSync(file, '{not json')
  assert.deepEqual(loadState(file), {})
  fs.writeFileSync(file, '[1,2]')
  assert.deepEqual(loadState(file), {})
  assert.equal(saveState(path.join(file, 'under-a-file', 'window.json'), { width: 1 }), false)
})

test('no state: the usual size, placed by the system', () => {
  assert.deepEqual(placeOnDisplays({}, ONE), { ...DEFAULT_SIZE, maximized: false })
  assert.deepEqual(DEFAULT_SIZE, { width: 1440, height: 900 })
})

test('comes back where it was when that screen is still there', () => {
  assert.deepEqual(placeOnDisplays({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, ONE),
    { x: 100, y: 80, width: 1000, height: 700, maximized: true })
  assert.deepEqual(placeOnDisplays({ x: 2000, y: 50, width: 1000, height: 700 }, TWO),
    { x: 2000, y: 50, width: 1000, height: 700, maximized: false })
})

test('a window left on a screen that is gone comes back on one that exists', () => {
  assert.deepEqual(placeOnDisplays({ x: 2000, y: 50, width: 1000, height: 700 }, ONE),
    { width: 1000, height: 700, maximized: false })
  assert.deepEqual(placeOnDisplays({ x: -5000, y: -5000, width: 1000, height: 700 }, TWO),
    { width: 1000, height: 700, maximized: false })
  // Its top bar must be reachable: a window whose top is above, below or beside every screen is moved.
  assert.equal('x' in placeOnDisplays({ x: 100, y: -300, width: 1000, height: 700 }, ONE), false)
  assert.equal('x' in placeOnDisplays({ x: 100, y: 1070, width: 1000, height: 700 }, ONE), false)
  assert.equal('x' in placeOnDisplays({ x: 1900, y: 100, width: 1000, height: 700 }, ONE), false)
})

test('never larger than the screen it opens on, never uselessly small', () => {
  assert.deepEqual(placeOnDisplays({ x: 0, y: 0, width: 4000, height: 3000 }, ONE),
    { x: 0, y: 0, width: 1920, height: 1080, maximized: false })
  assert.deepEqual(placeOnDisplays({ width: 4000, height: 3000 }, ONE), { width: 1920, height: 1080, maximized: false })
  assert.deepEqual(placeOnDisplays({ x: 5, y: 5, width: 20, height: 'tall' }, ONE),
    { x: 5, y: 5, ...DEFAULT_SIZE, maximized: false })
  assert.deepEqual(placeOnDisplays({ x: 100, y: 80, width: 1000, height: 700 }, []),
    { width: 1000, height: 700, maximized: false })
})

test('Wayland: a window cannot be placed, so only its size and maximised state come back', () => {
  assert.deepEqual(placeOnDisplays({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, ONE, { wayland: true }),
    { width: 1000, height: 700, maximized: true })
  assert.deepEqual(placeOnDisplays({ x: 100, y: 80, width: 4000, height: 700 }, ONE, { wayland: true }),
    { width: 1920, height: 700, maximized: false })
})

test('knows a Wayland session, unless X11 was forced', () => {
  assert.equal(isWayland({ XDG_SESSION_TYPE: 'wayland' }, []), true)
  assert.equal(isWayland({ WAYLAND_DISPLAY: 'wayland-1' }, []), true)
  assert.equal(isWayland({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '' }, []), false)
  assert.equal(isWayland({}, []), false)
  assert.equal(isWayland({ XDG_SESSION_TYPE: 'wayland' }, ['electron', '--ozone-platform=x11']), false)
  assert.equal(isWayland({ XDG_SESSION_TYPE: 'x11' }, ['--ozone-platform=wayland']), true)
})
