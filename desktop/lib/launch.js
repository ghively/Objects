'use strict'
// What `objectapp` starts the shell with: one JSON object in the environment variable
// OBJECT_DESKTOP_LAUNCH, holding `url` (the one-time /_open link), `origin`
// (http://127.0.0.1:<port>), `stateDir`, `icon` (a file or null), `title` and `frame`
// ('hidden' | 'system'). Never on the command line: other local users can read a process's
// command line (the process list), not its environment. The link is a secret for a moment: no
// error made here ever repeats it, and `takeLaunch` removes the variable as it reads it, so
// nothing the shell starts afterwards (the default browser, a helper) inherits it.

const { sameOrigin } = require('./guard')

const LAUNCH_ENV = 'OBJECT_DESKTOP_LAUNCH'
const ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

/** The launch in `env` (`process.env`); throws, without repeating it, when it is missing or wrong. */
function parseLaunch(env) {
  const raw = env ? env[LAUNCH_ENV] : undefined
  if (typeof raw !== 'string' || raw === '') {
    throw new Error(`Object's window is started by objectapp (no ${LAUNCH_ENV} in its environment).`)
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`${LAUNCH_ENV} is not JSON.`)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${LAUNCH_ENV} is not an object.`)
  }
  const { url, origin, stateDir } = data
  const icon = data.icon === undefined ? null : data.icon
  const title = data.title === undefined ? 'Object' : data.title
  const frame = data.frame === undefined ? 'hidden' : data.frame
  if (typeof origin !== 'string' || !ORIGIN.test(origin)) throw new Error('The launch origin must be http://127.0.0.1:<port>.')
  if (typeof url !== 'string' || !sameOrigin(url, origin)) throw new Error('The launch link is not on the launch origin.')
  if (typeof stateDir !== 'string' || stateDir === '') throw new Error('The launch has no stateDir.')
  if (icon !== null && typeof icon !== 'string') throw new Error('The launch icon must be a file or null.')
  if (typeof title !== 'string') throw new Error('The launch title must be text.')
  if (frame !== 'hidden' && frame !== 'system') throw new Error('The launch frame must be "hidden" or "system".')
  return { url, origin, stateDir, icon, title, frame }
}

/** `parseLaunch`, and the variable is gone from `env` afterwards, whether it was good or not. */
function takeLaunch(env) {
  try {
    return parseLaunch(env)
  } finally {
    if (env) delete env[LAUNCH_ENV]
  }
}

module.exports = { LAUNCH_ENV, parseLaunch, takeLaunch }
