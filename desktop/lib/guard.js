'use strict'
// What the window may show. Only the launch origin (the app on 127.0.0.1) ever loads in a
// window; a link to another site goes to the default browser when a person just clicked or
// pressed a key in the window (`handOffAllowed`); anything else goes nowhere.

/** True when `url` is a page of `origin` (`http://127.0.0.1:<port>`). */
function sameOrigin(url, origin) {
  try {
    const u = new URL(String(url))
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin
  } catch {
    return false
  }
}

const EXTERNAL = new Set(['http:', 'https:', 'mailto:'])

/** What to do with a navigation of the window itself. */
function navigation(url, origin) {
  if (sameOrigin(url, origin)) return { action: 'allow' }
  return windowOpen(url, origin)
}

/** What to do with `window.open` / a `target="_blank"` link: never a second app window. */
function windowOpen(url, origin) {
  if (sameOrigin(url, origin)) return { action: 'deny' }
  try {
    const u = new URL(String(url))
    if (EXTERNAL.has(u.protocol)) return { action: 'external', url: u.href }
  } catch {
    // not a URL
  }
  return { action: 'deny' }
}

/**
 * How soon after a person's click or key a page may hand a link to the default browser. Opening
 * the browser is something a person asks for; a page or a frame that opens it by itself (an
 * embedded page of another site calling `window.open` as it loads) is refused.
 */
const GESTURE_MS = 1000

const USER_INPUTS = new Set(['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'keyUp', 'char', 'touchStart', 'touchEnd', 'gestureTap'])

/** Whether an `input-event` of this type is a person's click, tap or key. */
function isUserInput(type) {
  return USER_INPUTS.has(type)
}

/**
 * Whether a link may go to the default browser now: a person's input reached that window
 * (`lastInput`, a time in ms) within `GESTURE_MS` before `now`, and the request came from the
 * app's own page: its main frame, or a frame of the launch origin. `frameUrl` is that frame's URL
 * (a `window.open` gives only its referrer, empty with `noreferrer`): unknown, the input alone
 * decides; known and of another origin, it is refused.
 */
function handOffAllowed({ now, lastInput, origin, isMainFrame = null, frameUrl = null, windowMs = GESTURE_MS }) {
  if (typeof lastInput !== 'number' || typeof now !== 'number') return false
  if (now < lastInput || now - lastInput > windowMs) return false
  if (isMainFrame === true) return true
  if (typeof frameUrl === 'string' && frameUrl !== '') return sameOrigin(frameUrl, origin)
  return isMainFrame !== false
}

/**
 * One window's hand-offs: `input(type)` for each of its `input-event`s, `navigationStarted()` when
 * its main frame starts a navigation, and `allowed(kind, frame)` for a `window.open` ('open'), a
 * navigation away ('navigate') or a server's redirect away ('redirect'). A redirect is judged by
 * when its navigation started, so a person's click on a link that the server sends elsewhere
 * still goes out however long the server took.
 */
function createHandOffs(origin, clock = Date.now) {
  let lastInput = null
  let navigationAt = null
  return {
    input(type) {
      if (isUserInput(type)) lastInput = clock()
    },
    navigationStarted() {
      navigationAt = clock()
    },
    allowed(kind, frame = {}) {
      const now = kind === 'redirect' && navigationAt !== null ? navigationAt : clock()
      return handOffAllowed({ now, lastInput, origin, ...frame })
    },
  }
}

module.exports = { sameOrigin, navigation, windowOpen, handOffAllowed, isUserInput, createHandOffs, GESTURE_MS }
