'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const { lineReader, parseCommand, listenToParent } = require('../lib/stdinLines')

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
    JSON.stringify({ kind: 'Quit' }),
  ]) {
    assert.equal(parseCommand(line, ORIGIN), null, line)
  }
})

test('reads the quit line', () => {
  assert.deepEqual(parseCommand('{"kind": "quit"}', ORIGIN), { kind: 'quit' })
  assert.deepEqual(parseCommand(JSON.stringify({ kind: 'quit', open: 'x' }), ORIGIN), { kind: 'quit' })
})

function parent(started = () => true) {
  const stream = new PassThrough()
  const calls = []
  listenToParent(stream, ORIGIN, { open: (url) => calls.push(['open', url]), quit: () => calls.push(['quit']), started })
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  return { stream, calls, settle }
}

test('objectapp asks the shell to quit with the quit line, once', async () => {
  const { stream, calls, settle } = parent()
  const open = 'http://127.0.0.1:8891/_open?code=abc&next=/%3Fmini%3Dwork'
  stream.write(`${JSON.stringify({ open, kind: 'focus' })}\n`)
  stream.write('{"kind": "quit"}\n')
  stream.end()
  await settle()
  assert.deepEqual(calls, [['open', open], ['quit']])
})

test('after the quit line, a keep-on-top line opens nothing', async () => {
  const { stream, calls, settle } = parent()
  stream.write('{"kind": "quit"}\n')
  stream.write(`${JSON.stringify({ open: `${ORIGIN}/_open?code=x`, kind: 'focus' })}\n`)
  await settle()
  assert.deepEqual(calls, [['quit']])
})

test('the end of stdin means objectapp is gone: the shell quits', async () => {
  const { stream, calls, settle } = parent()
  stream.end()
  await settle()
  assert.deepEqual(calls, [['quit']])
})

test('an end of stdin before the window said it was ready is not taken for objectapp going', async () => {
  let ready = false
  const { stream, calls, settle } = parent(() => ready)
  stream.end()
  await settle()
  ready = true
  await settle()
  assert.deepEqual(calls, [])
})

test('a stdin that fails is objectapp gone, not a crash', async () => {
  const { stream, calls, settle } = parent()
  stream.destroy(new Error('EPIPE'))
  await settle()
  assert.deepEqual(calls, [['quit']])
})
