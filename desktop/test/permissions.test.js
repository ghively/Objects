'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { permissionAllowed } = require('../lib/permissions')

const ORIGIN = 'http://127.0.0.1:8891'
const APP = 'http://127.0.0.1:8891/'

test('reminders, the clipboard, the microphone and full screen are allowed for the app', () => {
  assert.equal(permissionAllowed('notifications', APP, ORIGIN), true)
  assert.equal(permissionAllowed('clipboard-read', APP, ORIGIN), true)
  assert.equal(permissionAllowed('clipboard-sanitized-write', APP, ORIGIN), true)
  assert.equal(permissionAllowed('fullscreen', APP, ORIGIN), true)
  assert.equal(permissionAllowed('media', APP, ORIGIN, { mediaTypes: ['audio'] }), true)
  assert.equal(permissionAllowed('media', ORIGIN, ORIGIN, { mediaType: 'audio' }), true)
})

test('the camera is not the microphone', () => {
  assert.equal(permissionAllowed('media', APP, ORIGIN, { mediaTypes: ['video'] }), false)
  assert.equal(permissionAllowed('media', APP, ORIGIN, { mediaTypes: ['audio', 'video'] }), false)
  assert.equal(permissionAllowed('media', APP, ORIGIN, { mediaType: 'video' }), false)
  assert.equal(permissionAllowed('media', APP, ORIGIN, { mediaType: 'unknown' }), false)
  assert.equal(permissionAllowed('media', APP, ORIGIN, { mediaTypes: [] }), false)
  assert.equal(permissionAllowed('media', APP, ORIGIN, {}), false)
  assert.equal(permissionAllowed('media', APP, ORIGIN), false)
})

test('everything else is refused', () => {
  for (const p of ['geolocation', 'display-capture', 'midi', 'midiSysex', 'pointerLock', 'openExternal', 'hid', 'serial',
    'usb', 'fileSystem', 'idle-detection', 'window-management', 'local-fonts', 'persistent-storage', 'unknown',
    'deprecated-sync-clipboard-read', 'mediaKeySystem', 'sensors', 'screen-wake-lock', undefined]) {
    assert.equal(permissionAllowed(p, APP, ORIGIN, { mediaTypes: ['audio'] }), false, String(p))
  }
})

test('nothing is allowed for another site, even inside the app', () => {
  for (const p of ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'media']) {
    assert.equal(permissionAllowed(p, 'https://example.com/', ORIGIN, { mediaTypes: ['audio'] }), false, p)
    assert.equal(permissionAllowed(p, 'http://127.0.0.1:9999/', ORIGIN, { mediaTypes: ['audio'] }), false, p)
    assert.equal(permissionAllowed(p, undefined, ORIGIN, { mediaTypes: ['audio'] }), false, p)
    assert.equal(permissionAllowed(p, '', ORIGIN, { mediaTypes: ['audio'] }), false, p)
  }
})
