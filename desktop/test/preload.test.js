'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

/** Loads preload.js against a fake `electron`; returns what it exposed and the fake IPC. */
function loadPreload(info = { platform: 'linux', controls: 'custom', framed: false }) {
  const exposed = {}
  const listeners = {}
  const sent = []
  const invoked = []
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } },
    ipcRenderer: {
      sendSync: (channel) => { sent.push([channel, 'sync']); return info },
      send: (channel, ...args) => { sent.push([channel, ...args]) },
      invoke: (channel, ...args) => { invoked.push([channel, ...args]); return Promise.resolve('answer') },
      on: (channel, fn) => { listeners[channel] = fn },
    },
  }
  const file = path.join(__dirname, '..', 'preload.js')
  delete require.cache[file]
  const load = Module._load
  Module._load = (request, ...rest) => (request === 'electron' ? electron : load(request, ...rest))
  try {
    require(file)
  } finally {
    Module._load = load
  }
  return { exposed, listeners, sent, invoked }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('exposes the bridge and nothing else', () => {
  const { exposed } = loadPreload()
  assert.deepEqual(Object.keys(exposed), ['objectDesktop'])
  assert.deepEqual(Object.keys(exposed.objectDesktop).sort(), [
    'close', 'controls', 'framed', 'isFullScreen', 'isMaximized', 'minimize', 'onBeforeClose', 'onWindowState',
    'platform', 'setSpellCheckLanguage', 'setTheme', 'setWindowButtons', 'toggleMaximize',
  ])
  assert.equal(exposed.objectDesktop.platform, 'linux')
  assert.equal(exposed.objectDesktop.controls, 'custom')
  assert.equal(exposed.objectDesktop.framed, false)
})

test('the window calls go to the shell', async () => {
  const { exposed, sent, invoked } = loadPreload()
  const d = exposed.objectDesktop
  sent.length = 0
  assert.equal(d.minimize(), undefined)
  d.toggleMaximize()
  d.close()
  d.setTheme({ mode: 'dark', background: '#000000', foreground: '#ffffff' })
  assert.deepEqual(sent, [
    ['object-desktop:minimize'],
    ['object-desktop:toggle-maximize'],
    ['object-desktop:close'],
    ['object-desktop:set-theme', { mode: 'dark', background: '#000000', foreground: '#ffffff' }],
  ])
  assert.equal(await d.isMaximized(), 'answer')
  assert.equal(await d.isFullScreen(), 'answer')
  assert.equal(await d.setWindowButtons('hide'), 'answer')
  assert.deepEqual(invoked, [
    ['object-desktop:is-maximized'], ['object-desktop:is-full-screen'], ['object-desktop:set-window-buttons', 'hide'],
  ])
})

test('window state changes reach every subscriber until it unsubscribes', () => {
  const { exposed, listeners } = loadPreload()
  const seen = []
  const off = exposed.objectDesktop.onWindowState((s) => seen.push(s))
  exposed.objectDesktop.onWindowState((s) => seen.push('second'))
  listeners['object-desktop:window-state']({}, { maximized: true, fullScreen: false })
  off()
  listeners['object-desktop:window-state']({}, { maximized: false, fullScreen: false })
  assert.deepEqual(seen, [{ maximized: true, fullScreen: false }, 'second', 'second'])
})

test('before close: the handler saves, then the shell is told', async () => {
  const { exposed, listeners, sent } = loadPreload()
  sent.length = 0
  let release
  let ran = 0
  exposed.objectDesktop.onBeforeClose(() => { ran += 1; return new Promise((resolve) => { release = resolve }) })
  listeners['object-desktop:before-close']({})
  await tick()
  assert.equal(ran, 1)
  assert.deepEqual(sent, [])
  release()
  await tick()
  assert.deepEqual(sent, [['object-desktop:before-close-done']])
})

test('before close: no handler, a failing handler and a removed handler all answer at once', async () => {
  const { exposed, listeners, sent } = loadPreload()
  sent.length = 0
  listeners['object-desktop:before-close']({})
  await tick()
  assert.equal(sent.length, 1)

  exposed.objectDesktop.onBeforeClose(() => { throw new Error('boom') })
  listeners['object-desktop:before-close']({})
  await tick()
  assert.equal(sent.length, 2)

  exposed.objectDesktop.onBeforeClose(() => Promise.reject(new Error('boom')))
  listeners['object-desktop:before-close']({})
  await tick()
  assert.equal(sent.length, 3)

  let ran = 0
  const off = exposed.objectDesktop.onBeforeClose(async () => { ran += 1 })
  off()
  listeners['object-desktop:before-close']({})
  await tick()
  assert.equal(ran, 0)
  assert.equal(sent.length, 4)
})

test('one handler: a new one replaces the old, and the old one\'s unsubscribe leaves the new one', async () => {
  const { exposed, listeners } = loadPreload()
  const ran = []
  const offFirst = exposed.objectDesktop.onBeforeClose(async () => { ran.push('first') })
  exposed.objectDesktop.onBeforeClose(async () => { ran.push('second') })
  offFirst()
  listeners['object-desktop:before-close']({})
  await tick()
  assert.deepEqual(ran, ['second'])
})

test('setSpellCheckLanguage sends the tag (or null) to the shell and returns nothing', () => {
  const { exposed, sent } = loadPreload()
  const d = exposed.objectDesktop
  sent.length = 0
  assert.equal(d.setSpellCheckLanguage('de-CH'), undefined)
  d.setSpellCheckLanguage(null)
  assert.deepEqual(sent, [
    ['object-desktop:set-spell-check-language', 'de-CH'],
    ['object-desktop:set-spell-check-language', null],
  ])
})
