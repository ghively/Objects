'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { sameOrigin, navigation, windowOpen, handOffAllowed, isUserInput, createHandOffs, GESTURE_MS } = require('../lib/guard')

const ORIGIN = 'http://127.0.0.1:8891'

test('only the launch origin is the app', () => {
  assert.equal(sameOrigin('http://127.0.0.1:8891/', ORIGIN), true)
  assert.equal(sameOrigin('http://127.0.0.1:8891', ORIGIN), true)
  assert.equal(sameOrigin('http://127.0.0.1:8891/_open?code=x&next=/', ORIGIN), true)
  assert.equal(sameOrigin('http://127.0.0.1:8892/', ORIGIN), false)
  assert.equal(sameOrigin('http://localhost:8891/', ORIGIN), false)
  assert.equal(sameOrigin('https://127.0.0.1:8891/', ORIGIN), false)
  assert.equal(sameOrigin('http://127.0.0.1:8891@example.com/', ORIGIN), false)
  assert.equal(sameOrigin('http://127.0.0.1:8891.example.com/', ORIGIN), false)
  assert.equal(sameOrigin('blob:http://127.0.0.1:8891/1234', ORIGIN), false)
  assert.equal(sameOrigin('not a url', ORIGIN), false)
  assert.equal(sameOrigin(undefined, ORIGIN), false)
})

test('the app loads in the window, other sites go to the browser, the rest goes nowhere', () => {
  assert.deepEqual(navigation('http://127.0.0.1:8891/#/note', ORIGIN), { action: 'allow' })
  assert.deepEqual(navigation('https://example.com/a?b=1', ORIGIN), { action: 'external', url: 'https://example.com/a?b=1' })
  assert.deepEqual(navigation('http://example.com/', ORIGIN), { action: 'external', url: 'http://example.com/' })
  assert.deepEqual(navigation('mailto:a@example.com', ORIGIN), { action: 'external', url: 'mailto:a@example.com' })
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'smb://host/share',
    'chrome://settings', 'about:blank', 'blob:http://example.com/1', '', 'nonsense', undefined]) {
    assert.deepEqual(navigation(url, ORIGIN), { action: 'deny' }, String(url))
  }
})

test('a new window is never the app in a second window', () => {
  assert.deepEqual(windowOpen('https://example.com/', ORIGIN), { action: 'external', url: 'https://example.com/' })
  assert.deepEqual(windowOpen('http://127.0.0.1:8891/', ORIGIN), { action: 'deny' })
  assert.deepEqual(windowOpen('file:///x', ORIGIN), { action: 'deny' })
})

test('the default browser opens only just after a person\'s click or key in that window', () => {
  assert.equal(GESTURE_MS, 1000)
  const at = (now, lastInput) => handOffAllowed({ now, lastInput, origin: ORIGIN, isMainFrame: true })
  assert.equal(at(10_000, 9_500), true)
  assert.equal(at(10_000, 9_000), true) // 1 second: still the same click
  assert.equal(at(10_000, 8_999), false)
  assert.equal(at(10_000, null), false) // nobody has touched the window
  assert.equal(at(10_000, undefined), false)
  assert.equal(at(10_000, 10_500), false) // an input "from the future" is no input
})

test('only the app\'s own page may hand a link to the browser, not a frame of another site', () => {
  const from = (frame) => handOffAllowed({ now: 5_000, lastInput: 4_800, origin: ORIGIN, ...frame })
  assert.equal(from({ isMainFrame: true }), true)
  assert.equal(from({ isMainFrame: false, frameUrl: 'http://127.0.0.1:8891/embed' }), true) // same origin
  assert.equal(from({ isMainFrame: false, frameUrl: 'http://127.0.0.1:8961/frame' }), false)
  assert.equal(from({ isMainFrame: false, frameUrl: 'https://www.youtube.com/embed/x' }), false)
  assert.equal(from({ isMainFrame: false, frameUrl: 'about:srcdoc' }), false)
  // A window.open says nothing of its frame but its referrer: a referrer of another site is that site.
  assert.equal(from({ frameUrl: 'http://127.0.0.1:8961/' }), false)
  assert.equal(from({ frameUrl: 'http://127.0.0.1:8891/' }), true)
  // No referrer (noreferrer, as the app's own links ask): the click alone decides.
  assert.equal(from({ frameUrl: '' }), true)
  assert.equal(from({}), true)
})

test('a window\'s hand-offs: a click, then the server sending its link elsewhere, still goes out', () => {
  let now = 0
  const h = createHandOffs(ORIGIN, () => now)
  assert.equal(h.allowed('open', { isMainFrame: true }), false) // nobody has touched it
  now = 1_000
  h.input('mouseMove')
  assert.equal(h.allowed('open', { isMainFrame: true }), false)
  h.input('mouseUp')
  now = 1_200
  h.navigationStarted() // the click followed a link of the app
  now = 4_000 // the server answers slowly, with a redirect to another site
  assert.equal(h.allowed('redirect', { isMainFrame: true }), true)
  assert.equal(h.allowed('open', { isMainFrame: true }), false)
  assert.equal(h.allowed('navigate', { isMainFrame: true }), false)
  h.navigationStarted() // the page by itself, long after the click
  now = 4_100
  assert.equal(h.allowed('redirect', { isMainFrame: true }), false)
  h.input('keyDown')
  assert.equal(h.allowed('open', { frameUrl: '' }), true)
  assert.equal(h.allowed('open', { frameUrl: 'http://127.0.0.1:8961/' }), false)
})

test('what counts as a person\'s input', () => {
  for (const type of ['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'keyUp', 'char', 'touchStart', 'touchEnd', 'gestureTap']) {
    assert.equal(isUserInput(type), true, type)
  }
  for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'mouseWheel', 'gestureScrollUpdate', 'undefined', '', undefined]) {
    assert.equal(isUserInput(type), false, String(type))
  }
})
