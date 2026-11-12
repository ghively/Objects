/**
 * M33: how many writes this window has on their way to the server right now (PUT, POST, PATCH and
 * DELETE requests whose answer has not come). The desktop window asks before it closes
 * (`beforeClose.ts`): a browser finishes a `keepalive` save after its tab is gone, but the shell's
 * window is the whole program, so a save still on its way when it closes would be cut off.
 *
 * Nothing in the app says this for every kind of save (a note's text and title publish a state;
 * whiteboards, drawings and property edits publish none), so inside the shell, and only there,
 * `window.fetch` is wrapped to count them. The wrapper passes every call through untouched and
 * hands back the very same promise; it reads the method and nothing else. A browser tab and the
 * pywebview window never install it.
 */

const WRITE = /^(PUT|POST|PATCH|DELETE)$/i

let inFlight = 0
let original: typeof fetch | null = null
let wrapper: typeof fetch | null = null

/** Writes sent and not yet answered (0 until `trackWrites()` has been called). */
export function writesInFlight(): number {
  return inFlight
}

/** Start counting. Called once, before the app's first request (`registerBeforeClose`). */
export function trackWrites(): void {
  if (original || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  const real = window.fetch
  original = real
  wrapper = function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    const answer = real.call(window, input, init)
    if (WRITE.test(method)) {
      inFlight += 1
      const done = () => {
        inFlight -= 1
      }
      // Answered or failed: either way it is no longer on its way.
      answer.then(done, done)
    }
    return answer
  }
  window.fetch = wrapper
}

/** Tests: put `fetch` back and forget what was counted. */
export function untrackWrites(): void {
  if (original && window.fetch === wrapper) window.fetch = original
  original = null
  wrapper = null
  inFlight = 0
}
