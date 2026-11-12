'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { lineReader, parseCommand } = require('../lib/stdinLines')

const ORIGIN = 'http://127.0.0.1:8891'

test('gives whole lines however the bytes arrive', () => {
  const lines = []
  const feed = lineReader((l) => lines.push(l))
  feed(Buffer.from('{"a"'))
  assert.deepEqual(lines, [])
  feed(':1}\n{"b":2}\r\n\n{"c"')
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}'])
  feed(Buffer.from(':3}\n'))
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}'])
})

test('a character split across two chunks stays whole', () => {
  const lines = []
  const feed = lineReader((l) => lines.push(l))
  const bytes = Buffer.from('{"t":"é"}\n')
  feed(bytes.subarray(0, 7))
  feed(bytes.subarray(7))
  assert.deepEqual(lines, ['{"t":"é"}'])
})

test('a line that never ends is dropped, not kept for ever', () => {
  const lines = []
  const feed = lineReader((l) => lines.push(l), 64)
  feed('x'.repeat(200))
  feed('yyy\n{"ok":1}\n')
  assert.deepEqual(lines, ['{"ok":1}'])
})

test('reads the keep-on-top line', () => {
  const open = 'http://127.0.0.1:8891/_open?code=abc&next=/%3Fmini%3Dwork'
  assert.deepEqual(parseCommand(JSON.stringify({ open, kind: 'focus' }), ORIGIN), { open, kind: 'focus' })
})

test('ignores anything else', () => {
  for (const line of [
    'hello', '[]', 'null', '{}',
    JSON.stringify({ open: 'https://example.com/', kind: 'focus' }),
    JSON.stringify({ open: 'http://127.0.0.1:9999/', kind: 'focus' }),
    JSON.stringify({ open: 'http://127.0.0.1:8891/', kind: 'other' }),
    JSON.stringify({ open: 7, kind: 'focus' }),
  ]) {
    assert.equal(parseCommand(line, ORIGIN), null, line)
  }
})
