'use strict'
// The launch argument `objectapp` starts the shell with: `--object-launch=<json>` holding
// `url` (the one-time /_open link), `origin` (http://127.0.0.1:<port>), `stateDir`, `icon`
// (a file or null), `title` and `frame` ('hidden' | 'system'). The link is a secret for a
// moment: no error made here ever repeats the argument.

const { sameOrigin } = require('./guard')

const PREFIX = '--object-launch='
const ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

function parseLaunch(argv) {
  const raw = (argv || []).find((a) => typeof a === 'string' && a.startsWith(PREFIX))
  if (raw === undefined) throw new Error('Object\'s window is started by objectapp (no --object-launch argument).')
  let data
  try {
    data = JSON.parse(raw.slice(PREFIX.length))
  } catch {
    throw new Error('The --object-launch argument is not JSON.')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The --object-launch argument is not an object.')
  }
  const { url, origin, stateDir } = data
  const icon = data.icon === undefined ? null : data.icon
  const title = data.title === undefined ? 'Object' : data.title
  const frame = data.frame === undefined ? 'hidden' : data.frame
  if (typeof origin !== 'string' || !ORIGIN.test(origin)) throw new Error('The launch origin must be http://127.0.0.1:<port>.')
  if (typeof url !== 'string' || !sameOrigin(url, origin)) throw new Error('The launch link is not on the launch origin.')
  if (typeof stateDir !== 'string' || stateDir === '') throw new Error('The launch argument has no stateDir.')
  if (icon !== null && typeof icon !== 'string') throw new Error('The launch icon must be a file or null.')
  if (typeof title !== 'string') throw new Error('The launch title must be text.')
  if (frame !== 'hidden' && frame !== 'system') throw new Error('The launch frame must be "hidden" or "system".')
  return { url, origin, stateDir, icon, title, frame }
}

module.exports = { parseLaunch }
