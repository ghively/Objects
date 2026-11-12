'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { sameOrigin, navigation, windowOpen } = require('../lib/guard')

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
