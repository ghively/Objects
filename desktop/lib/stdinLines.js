'use strict'
// `objectapp` talks to the shell over its stdin, one JSON object per line:
// - `{"open": "<one-time url>", "kind": "focus"}`: open Keep on top's window (M23);
// - `{"kind": "quit"}`: close every window as a person's close does (the page saves first), then
//   quit. `objectapp` writes it when it is stopping (Ctrl-C, SIGTERM, a closed console), then
//   closes the pipe.
// The end of stdin means the same as the quit line: `objectapp` is gone (the pipe is open for
// the shell's whole life otherwise), so the window closes rather than stay on a stopped server.

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
  if (data.kind === 'quit') return { kind: 'quit' }
  if (data.kind !== 'focus' || typeof data.open !== 'string' || !sameOrigin(data.open, origin)) return null
  return { open: data.open, kind: 'focus' }
}

/**
 * Reads `stream` (the shell's stdin): a keep-on-top line calls `open(url)`; the quit line, or
 * the end of the stream (`objectapp` is gone), calls `quit()`, once, and nothing opens after it.
 * An end that comes before `started()` is true (before the window said it was ready) is not
 * taken for `objectapp` going: `objectapp` keeps the pipe open for the shell's life, so such an
 * end can only be a stdin that was never connected, and a window must not close at launch for it.
 */
function listenToParent(stream, origin, { open, quit, started = () => true }) {
  let quitting = false
  const quitOnce = () => {
    if (quitting) return
    quitting = true
    quit()
  }
  const feed = lineReader((line) => {
    const command = parseCommand(line, origin)
    if (command === null || quitting) return
    if (command.kind === 'quit') quitOnce()
    else open(command.open)
  })
  const gone = () => {
    if (started()) quitOnce()
  }
  stream.on('error', gone)
  stream.on('data', feed)
  stream.on('end', gone)
  stream.on('close', gone)
}

module.exports = { lineReader, parseCommand, listenToParent }
