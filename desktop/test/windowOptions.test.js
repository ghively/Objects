'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  TOP_BAR_HEIGHT, TRAFFIC_LIGHTS, DEFAULT_THEME, cleanTheme, overlayFor, windowOptions, focusWindowOptions,
  webPreferences,
} = require('../lib/windowOptions')

const DARK = { mode: 'dark', background: '#18181b', foreground: '#fafafa' }

test('Windows: a hidden title bar with the system buttons over the top bar, in the theme colours', () => {
  const o = windowOptions('win32', DARK, { width: 1000, height: 700 })
  assert.equal(o.titleBarStyle, 'hidden')
  assert.deepEqual(o.titleBarOverlay, { color: '#18181b', symbolColor: '#fafafa', height: TOP_BAR_HEIGHT })
  assert.equal(o.frame, undefined)
  assert.equal(o.backgroundColor, '#18181b')
  assert.equal(TOP_BAR_HEIGHT, 42)
})

test('macOS: the traffic lights sit inset in the top bar', () => {
  const o = windowOptions('darwin', DARK, {})
  assert.equal(o.titleBarStyle, 'hiddenInset')
  assert.deepEqual(o.trafficLightPosition, { x: TRAFFIC_LIGHTS.x, y: TRAFFIC_LIGHTS.y })
  assert.equal(o.titleBarOverlay, undefined)
  assert.equal(o.frame, undefined)
})

test('Linux: no frame at all', () => {
  const o = windowOptions('linux', DARK, {})
  assert.equal(o.frame, false)
  assert.equal(o.titleBarStyle, undefined)
  assert.equal(o.titleBarOverlay, undefined)
})

test('every system: the title, the size and place it had, no menu bar showing', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const o = windowOptions(platform, null, { x: 30, y: 40, width: 1000, height: 700 })
    assert.equal(o.title, 'Object')
    assert.deepEqual([o.x, o.y, o.width, o.height], [30, 40, 1000, 700])
    assert.equal(o.backgroundColor, DEFAULT_THEME.background)
    assert.equal(o.autoHideMenuBar, true)
    assert.equal(o.alwaysOnTop, undefined)
    assert.equal(o.show, false)
  }
  const fresh = windowOptions('linux', null, {})
  assert.deepEqual([fresh.width, fresh.height], [1440, 900])
  assert.equal('x' in fresh, false)
  assert.equal('y' in fresh, false)
})

test('the keep-on-top window: small, on top, with the system frame so it can be moved and closed', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const o = focusWindowOptions(platform, DARK)
    assert.deepEqual([o.width, o.height, o.alwaysOnTop, o.title], [360, 470, true, 'Object focus'])
    assert.equal(o.backgroundColor, '#18181b')
    assert.equal(o.frame, undefined)
    assert.equal(o.titleBarStyle, undefined)
    assert.equal(o.titleBarOverlay, undefined)
  }
})

test('the page gets no Node: isolated, sandboxed, only the preload', () => {
  assert.deepEqual(webPreferences('/x/preload.js'), {
    preload: '/x/preload.js',
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: true,
  })
})

test('a theme from the page is taken only when it is a mode and two hex colours', () => {
  assert.deepEqual(cleanTheme({ mode: 'dark', background: '#18181B', foreground: '#fff', extra: 1 }),
    { mode: 'dark', background: '#18181B', foreground: '#fff' })
  assert.equal(cleanTheme({ mode: 'sepia', background: '#000000', foreground: '#ffffff' }), null)
  assert.equal(cleanTheme({ mode: 'dark', background: 'red', foreground: '#ffffff' }), null)
  assert.equal(cleanTheme({ mode: 'dark', background: '#12345', foreground: '#ffffff' }), null)
  assert.equal(cleanTheme({ mode: 'dark', background: '#000000', foreground: 'url(x)' }), null)
  assert.equal(cleanTheme(null), null)
  assert.equal(cleanTheme('dark'), null)
  assert.deepEqual(overlayFor(null), { color: DEFAULT_THEME.background, symbolColor: DEFAULT_THEME.foreground, height: 42 })
})

test('--frame system: an ordinary framed window on every system', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const o = windowOptions(platform, DARK, { x: 1, y: 2, width: 1000, height: 700 }, 'system')
    assert.equal(o.frame, true)
    assert.equal(o.titleBarStyle, undefined)
    assert.equal(o.titleBarOverlay, undefined)
    assert.equal(o.trafficLightPosition, undefined)
    assert.deepEqual([o.x, o.y, o.width, o.height, o.title], [1, 2, 1000, 700, 'Object'])
    assert.equal(o.backgroundColor, '#18181b')
  }
})

test('--frame hidden is the default', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(windowOptions(platform, DARK, {}, 'hidden'), windowOptions(platform, DARK, {}))
  }
  assert.equal(windowOptions('win32', DARK, {}, 'hidden').titleBarStyle, 'hidden')
  assert.equal(windowOptions('darwin', DARK, {}, 'hidden').titleBarStyle, 'hiddenInset')
  assert.equal(windowOptions('linux', DARK, {}, 'hidden').frame, false)
})
