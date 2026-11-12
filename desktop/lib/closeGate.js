'use strict'
// Closing loses nothing: on a window's close the shell asks the page to save first, waits for
// its answer or 3 seconds, then closes.

const BEFORE_CLOSE_MS = 3000

/**
 * @param {object} o
 * @param {() => boolean} o.ask      ask the page; false when it cannot be asked (not loaded, crashed)
 * @param {() => void} o.proceed     close the window now (its close event comes through `onClose` again)
 * @returns {{ onClose(): boolean, answered(): void, sessionEnding(): boolean }}  `onClose` is true
 *   when the window may close
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
    /**
     * Windows is about to shut down or log off (`query-session-end`): the page is asked to save
     * now, as for a close, but nothing is held (the system's shutdown is not delayed) and its
     * answer closes nothing. False when it was not asked (the gate is already closing the
     * window, or the page cannot be asked).
     */
    sessionEnding() {
      if (state !== 'open') return false
      try {
        return ask() === true
      } catch {
        return false
      }
    },
  }
}

module.exports = { createCloseGate, BEFORE_CLOSE_MS }
