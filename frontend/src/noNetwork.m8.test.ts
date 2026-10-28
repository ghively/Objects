// M8 Review Focus 6, "No network at runtime": no source under `frontend/src` (tests aside) may
// reach a URL off the app's own origin. Network calls live in `api/` (same-origin `/api/...`);
// anywhere else, a `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` or dynamic
// `import()` aimed at an `http(s)://` or protocol-relative URL fails this test, and so does any
// `XMLHttpRequest`/`WebSocket`/`sendBeacon` use at all outside `api/`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__fixtures__' || name === 'test') continue
      sources(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Comments removed (string contents kept), so a URL in a doc comment is not a call. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

const REMOTE_CALL =
  /\b(?:fetch|import|sendBeacon|EventSource|WebSocket)\s*\(\s*['"`](?:https?:)?\/\//
const ALWAYS_BANNED = /\bnew\s+(?:XMLHttpRequest|WebSocket)\b|\bsendBeacon\s*\(/

describe('no network at runtime (M8)', () => {
  it('test no network calls in m8 sources', () => {
    const files = sources(SRC)
    expect(files.length).toBeGreaterThan(100)
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(SRC, file).split(sep).join('/')
      const code = stripComments(readFileSync(file, 'utf8'))
      code.split('\n').forEach((line, i) => {
        if (REMOTE_CALL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        if (!rel.startsWith('api/') && ALWAYS_BANNED.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('every fetch outside api/ targets the same origin', () => {
    const offenders: string[] = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (rel.startsWith('api/')) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const m of code.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)) {
        const arg = m[1].trim()
        // A literal must be a same-origin path; a variable must be built from one in this file.
        const literal = /^['"`]/.test(arg)
        const sameOrigin = /^['"`]\/(?!\/)/.test(arg) || /^`\$\{BASE\}/.test(arg)
        if (literal && !sameOrigin) offenders.push(`${rel}: fetch(${arg})`)
        if (!literal && !/['"`]\/api[/'"`]/.test(code)) offenders.push(`${rel}: fetch(${arg}) with no /api route in the file`)
      }
    }
    expect(offenders).toEqual([])
  })
})
