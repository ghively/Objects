'use strict'
// What the window may show. Only the launch origin (the app on 127.0.0.1) ever loads in a
// window; a link to another site goes to the default browser; anything else goes nowhere.

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

module.exports = { sameOrigin, navigation, windowOpen }
