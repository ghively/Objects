'use strict'
// Permissions: notifications (reminders), the clipboard, the microphone (audio notes) and full
// screen (presentations), for the app's own origin; everything else, and every other site, is
// refused. Names are Electron 45.3.0's (`session.setPermissionRequestHandler`).

const { sameOrigin } = require('./guard')

const ALLOWED = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'])

/**
 * @param {string} permission
 * @param {string} requestingUrl  the asking frame's URL or origin
 * @param {string} origin         the launch origin
 * @param {object} [details]      a request's `mediaTypes` (['audio']) or a check's `mediaType` ('audio')
 */
function permissionAllowed(permission, requestingUrl, origin, details = {}) {
  if (!sameOrigin(requestingUrl, origin)) return false
  if (ALLOWED.has(permission)) return true
  if (permission === 'media') {
    const d = details || {}
    if (Array.isArray(d.mediaTypes)) return d.mediaTypes.length > 0 && d.mediaTypes.every((m) => m === 'audio')
    return d.mediaType === 'audio'
  }
  return false
}

module.exports = { permissionAllowed }
