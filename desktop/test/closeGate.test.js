'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createCloseGate, BEFORE_CLOSE_MS } = require('../lib/closeGate')
const { createPending } = require('../lib/pending')

function fakeTimers() {
  const pending = []
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms }; pending.push(t); return t },
    clearTimeout: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1) },
    pending,
    fire: () => pending.splice(0).forEach((t) => t.fn()),
  }
}

function gate(extra = {}) {
  const calls = []
  const timers = fakeTimers()
  const g = createCloseGate({
    ask: () => { calls.push('ask'); return true },
    proceed: () => calls.push('proceed'),
    timers,
    ...extra,
  })
  return { g, calls, timers }
}

test('the first close asks the page and holds the window open', () => {
  const { g, calls, timers } = gate()
  assert.equal(g.onClose(), false)
  assert.deepEqual(calls, ['ask'])
  assert.equal(timers.pending.length, 1)
  assert.equal(timers.pending[0].ms, 3000)
  assert.equal(BEFORE_CLOSE_MS, 3000)
})

test('the page answers: the window closes, once', () => {
  const { g, calls, timers } = gate()
  g.onClose()
  g.answered()
  assert.deepEqual(calls, ['ask', 'proceed'])
  assert.equal(timers.pending.length, 0)
  assert.equal(g.onClose(), true) // the close that `proceed` makes goes through
  g.answered()
  timers.fire()
  assert.deepEqual(calls, ['ask', 'proceed'])
})

test('no answer in 3 seconds: the window closes anyway', () => {
  const { g, calls, timers } = gate()
  g.onClose()
  timers.fire()
  assert.deepEqual(calls, ['ask', 'proceed'])
  assert.equal(g.onClose(), true)
})

test('a second close while waiting neither asks again nor closes early', () => {
  const { g, calls } = gate()
  g.onClose()
  assert.equal(g.onClose(), false)
  assert.deepEqual(calls, ['ask'])
})

test('a page that cannot be asked (not loaded, crashed) does not hold the window', () => {
  const { g, calls, timers } = gate({ ask: () => false })
  assert.equal(g.onClose(), false)
  assert.deepEqual(calls, ['proceed'])
  assert.equal(timers.pending.length, 0)
  assert.equal(g.onClose(), true)
})

test('an answer nobody asked for closes nothing', () => {
  const { g, calls } = gate()
  g.answered()
  assert.deepEqual(calls, [])
})

test('requests still on their way are waited for, up to a limit', async () => {
  const timers = fakeTimers()
  const p = createPending(timers)
  assert.equal(await p.whenIdle(2000), true)
  p.start(1)
  p.start(2)
  p.start(2)
  let done = null
  p.whenIdle(2000).then((v) => { done = v })
  p.end(1)
  await Promise.resolve()
  assert.equal(done, null)
  p.end(2)
  await Promise.resolve()
  assert.equal(done, true)
  assert.equal(timers.pending.length, 0)

  p.start(3)
  let late = null
  p.whenIdle(2000).then((v) => { late = v })
  assert.equal(timers.pending[0].ms, 2000)
  timers.fire()
  await Promise.resolve()
  assert.equal(late, false)
  p.end(3)
  p.end('never started')
})
