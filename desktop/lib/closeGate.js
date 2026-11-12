'use strict'
// Closing loses nothing: on a window's close the shell asks the page to save first, waits for
// its answer or 3 seconds, then closes.

const BEFORE_CLOSE_MS = 3000

/**
 * @param {object} o
 * @param {() => boolean} o.ask      ask the page; false when it cannot be asked (not loaded, crashed)
 * @param {() => void} o.proceed     close the window now (its close event comes through `onClose` again)
 * @returns {{ onClose(): boolean, answered(): void }}  `onClose` is true when the window may close
 */
function createCloseGate({ ask, proceed, timeoutMs = BEFORE_CLOSE_MS, timers = globalThis }) {
  let state = 'open' // 'open' -> 'asking' -> 'closing'
  let timer = null

  function finish() {
    if (state !== 'asking') return
    state = 'closing'
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
    proceed()
  }

  return {
    onClose() {
      if (state === 'closing') return true
      if (state === 'asking') return false
      state = 'asking'
      let asked = false
      try {
        asked = ask() === true
      } catch {
        asked = false
      }
      if (asked) timer = timers.setTimeout(finish, timeoutMs)
      else finish()
      return false
    },
    answered: finish,
  }
}

module.exports = { createCloseGate, BEFORE_CLOSE_MS }
