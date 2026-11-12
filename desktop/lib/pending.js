'use strict'
// Requests still on their way. A page saves as it goes (`pagehide`, keep-alive requests), and
// those requests outlive the window; the shell waits for them (up to a limit) before it exits,
// because `objectapp` stops the server the moment the shell is gone.

function createPending(timers = globalThis) {
  const ids = new Set()
  let waiters = []

  function settle() {
    if (ids.size > 0) return
    const done = waiters
    waiters = []
    for (const w of done) w(true)
  }

  return {
    start(id) {
      ids.add(id)
    },
    end(id) {
      if (ids.delete(id)) settle()
    },
    get size() {
      return ids.size
    },
    /** Resolves true once nothing is on its way, or false after `timeoutMs`. */
    whenIdle(timeoutMs) {
      if (ids.size === 0) return Promise.resolve(true)
      return new Promise((resolve) => {
        let timer = null
        const waiter = (value) => {
          if (timer !== null) timers.clearTimeout(timer)
          resolve(value)
        }
        timer = timers.setTimeout(() => {
          timer = null
          waiters = waiters.filter((w) => w !== waiter)
          resolve(false)
        }, timeoutMs)
        waiters.push(waiter)
      })
    },
  }
}

module.exports = { createPending }
