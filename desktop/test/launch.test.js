'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseLaunch } = require('../lib/launch')

const GOOD = {
  url: 'http://127.0.0.1:8891/_open?code=abc&next=/',
  origin: 'http://127.0.0.1:8891',
  stateDir: '/tmp/state',
  icon: null,
  title: 'Object',
  frame: 'hidden',
}
const arg = (o) => `--object-launch=${JSON.stringify(o)}`

test('reads the launch argument wherever it is on the command line', () => {
  assert.deepEqual(parseLaunch(['electron', '.', '--no-sandbox', arg(GOOD)]), GOOD)
  assert.equal(parseLaunch([arg({ ...GOOD, icon: '/s/app-icon/app-icon-red.png' })]).icon, '/s/app-icon/app-icon-red.png')
})

test('the title defaults to Object, the icon to none and the frame to hidden', () => {
  const { url, origin, stateDir } = GOOD
  assert.deepEqual(parseLaunch([arg({ url, origin, stateDir })]), GOOD)
})

test('the system frame can be asked for', () => {
  assert.equal(parseLaunch([arg({ ...GOOD, frame: 'system' })]).frame, 'system')
})

test('refuses a missing or broken argument without repeating it', () => {
  assert.throws(() => parseLaunch(['electron', '.']), /--object-launch/)
  assert.throws(() => parseLaunch(['--object-launch={not json']), (e) => !/not json/.test(e.message))
  assert.throws(() => parseLaunch(['--object-launch=[]']))
  assert.throws(() => parseLaunch(['--object-launch=null']))
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
    assert.throws(() => parseLaunch([arg(bad)]), (e) => !e.message.includes('code=abc'), JSON.stringify(bad))
  }
})
