// No raw colour literals (hex, rgb()/rgba(), hsl()/hsla(), oklch()) in components: every colour
// is a token from theme/tokens.css and theme/themes.css, so all four themes reach every screen.
// A file holding a content palette (colours that are data, or that WebGL or an SVG file needs as
// values) opts out with a first-line comment `colour-literals: content palette`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const SRC = join(process.cwd(), 'src')

/** Files other lanes still convert; Task 19 empties this list. */
const PENDING: string[] = []

const MARKER = /^\s*(\/\/|\/\*)\s*colour-literals: content palette/

const LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|\b(?:rgba?|hsla?|oklch)\(/g

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__fixtures__' || name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|tsx|css)$/.test(name)) out.push(full)
  }
  return out
}

function scanned(): string[] {
  return walk(SRC)
    .map((f) => relative(SRC, f).split('\\').join('/'))
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith('test/') && !f.startsWith('theme/') && !f.includes('/test/'))
}

describe('no raw colours', () => {
  test('test no raw colour literals outside theme files', () => {
    const files = scanned()
    expect(files).toContain('index.css')
    expect(files).toContain('shell/Sidebar.tsx')
    const offenders: string[] = []
    for (const f of files) {
      if (PENDING.includes(f)) continue
      const text = readFileSync(join(SRC, f), 'utf8')
      if (MARKER.test(text.split('\n', 1)[0])) continue
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(LITERAL)) offenders.push(`${f}:${i + 1}: ${m[0]}`)
      })
    }
    expect(offenders).toEqual([])
  })

  test('the literal pattern catches each kind and spares ids', () => {
    const hits = (s: string) => [...s.matchAll(LITERAL)].map((m) => m[0])
    expect(hits('color: #1a2b3c; border: #fff; x: #33669980')).toEqual(['#1a2b3c', '#fff', '#33669980'])
    expect(hits('rgb(1 2 3) rgba(0,0,0,0) hsl(1 2% 3%) oklch(1 0 0)')).toEqual(['rgb(', 'rgba(', 'hsl(', 'oklch('])
    expect(hits('href="#root" #section-2 #add-button')).toEqual([])
  })

  test('pending files still exist', () => {
    // A pending entry whose file was renamed or removed would hide nothing; keep the list honest.
    const files = scanned()
    for (const f of PENDING) expect(files, f).toContain(f)
  })
})
