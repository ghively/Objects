'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { LAUNCH_ENV, parseLaunch, takeLaunch } = require('../lib/launch')

const GOOD = {
  url: 'http://127.0.0.1:8891/_open?code=abc&next=/',
  origin: 'http://127.0.0.1:8891',
  stateDir: '/tmp/state',
  icon: null,
  title: 'Object',
  frame: 'hidden',
}
/** An environment holding the launch JSON `o` (a string is used as it is). */
const env = (o, more = {}) => ({ PATH: '/usr/bin', ...more, [LAUNCH_ENV]: typeof o === 'string' ? o : JSON.stringify(o) })

test('reads the launch from OBJECT_DESKTOP_LAUNCH in the environment', () => {
  assert.equal(LAUNCH_ENV, 'OBJECT_DESKTOP_LAUNCH')
  assert.deepEqual(parseLaunch(env(GOOD)), GOOD)
  assert.equal(parseLaunch(env({ ...GOOD, icon: '/s/app-icon/app-icon-red.png' })).icon, '/s/app-icon/app-icon-red.png')
})

test('the command line is never read: the link would be in the process list there', () => {
  assert.throws(() => parseLaunch({}, ['electron', '.', `--object-launch=${JSON.stringify(GOOD)}`]), /OBJECT_DESKTOP_LAUNCH/)
})

test('takeLaunch removes the variable as it reads it, so nothing the shell starts inherits it', () => {
  const e = env(GOOD, { HOME: '/home/x' })
  assert.deepEqual(takeLaunch(e), GOOD)
  assert.equal(LAUNCH_ENV in e, false)
  assert.equal(e.HOME, '/home/x')
  // Removed even when it is refused.
  const bad = env({ ...GOOD, origin: 'http://example.com' })
  assert.throws(() => takeLaunch(bad))
  assert.equal(LAUNCH_ENV in bad, false)
})

test('the title defaults to Object, the icon to none and the frame to hidden', () => {
  const { url, origin, stateDir } = GOOD
  assert.deepEqual(parseLaunch(env({ url, origin, stateDir })), GOOD)
})

test('the system frame can be asked for', () => {
  assert.equal(parseLaunch(env({ ...GOOD, frame: 'system' })).frame, 'system')
})

test('refuses a missing or broken launch without repeating it', () => {
  assert.throws(() => parseLaunch({}), /OBJECT_DESKTOP_LAUNCH/)
  assert.throws(() => parseLaunch(env('')), /OBJECT_DESKTOP_LAUNCH/)
  assert.throws(() => parseLaunch(env('{not json')), (e) => !/not json/.test(e.message))
  assert.throws(() => parseLaunch(env('[]')))
  assert.throws(() => parseLaunch(env('null')))
})

test('the origin must be this computer and the link must be on it', () => {
  for (const bad of [
    { ...GOOD, origin: 'http://example.com' },
    { ...GOOD, origin: 'https://127.0.0.1:8891' },
    { ...GOOD, origin: 'http://127.0.0.1:8891/' },
    { ...GOOD, origin: 'http://127.0.0.1' },
    { ...GOOD, origin: 7 },
    { ...GOOD, url: 'http://127.0.0.1:9999/_open?code=abc' },
    { ...GOOD, url: 'http://example.com/_open?code=abc' },
    { ...GOOD, url: 'file:///etc/passwd?code=abc' },
    { ...GOOD, stateDir: '' },
    { ...GOOD, stateDir: 7 },
    { ...GOOD, icon: 7 },
    { ...GOOD, title: 7 },
    { ...GOOD, frame: 'none' },
    { ...GOOD, frame: true },
  ]) {
    assert.throws(() => parseLaunch(env(bad)), (e) => !e.message.includes('code=abc'), JSON.stringify(bad))
  }
})
