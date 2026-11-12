'use strict'
// `objectapp` talks to the shell over its stdin, one JSON object per line. The only line so
// far: `{"open": "<one-time url>", "kind": "focus"}` (Keep on top, M23).

const { StringDecoder } = require('node:string_decoder')
const { sameOrigin } = require('./guard')

/** Returns `feed(chunk)`: call it with what stdin gives; `onLine` gets each whole, non-empty line. */
function lineReader(onLine, maxLength = 65536) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let skipping = false
  return function feed(chunk) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    let at
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).replace(/\r$/, '')
      buffer = buffer.slice(at + 1)
      if (skipping) skipping = false
      else if (line !== '') onLine(line)
    }
    if (buffer.length > maxLength) {
      buffer = ''
      skipping = true
    }
  }
}

/** The command a line holds, or null. `open` must be a link on the launch origin. */
function parseCommand(line, origin) {
  let data
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  if (data.kind !== 'focus' || typeof data.open !== 'string' || !sameOrigin(data.open, origin)) return null
  return { open: data.open, kind: 'focus' }
}

module.exports = { lineReader, parseCommand }
