/**
 * Search snippets and title matches. A snippet marks each match with U+0002 before and U+0003
 * after it; we split on those control characters and render `<b>` with React, so no HTML in a
 * snippet is ever parsed.
 */
import { Fragment } from 'react'
import { cpToUtf16 } from '@/lib/codepoints'

const START = '\u0002'
const END = '\u0003'

export interface HighlightPart {
  text: string
  hit: boolean
}

/** Split a snippet into plain and matched runs (an unclosed match runs to the end). */
export function splitHighlights(snippet: string): HighlightPart[] {
  const out: HighlightPart[] = []
  let hit = false
  let buf = ''
  const flush = () => {
    if (buf) out.push({ text: buf, hit })
    buf = ''
  }
  for (const ch of snippet) {
    if (ch === START) {
      flush()
      hit = true
    } else if (ch === END) {
      flush()
      hit = false
    } else {
      buf += ch
    }
  }
  flush()
  return out
}

export function Highlight({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className ? `search-highlights ${className}` : 'search-highlights'}>
      {splitHighlights(text).map((p, i) => (p.hit ? <b key={i}>{p.text}</b> : <Fragment key={i}>{p.text}</Fragment>))}
    </span>
  )
}

/** Split `title` by `[start, end)` code-point spans from the backend (clamped, overlaps merged). */
export function splitTitle(title: string, matches: readonly (readonly [number, number])[]): HighlightPart[] {
  const spans = matches
    .map(([s, e]) => [cpToUtf16(title, s), cpToUtf16(title, e)] as const)
    .map(([s, e]) => [Math.max(0, Math.min(s, title.length)), Math.max(0, Math.min(e, title.length))] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
  const out: HighlightPart[] = []
  let at = 0
  for (const [s, e] of spans) {
    if (e <= at) continue
    const from = Math.max(s, at)
    if (from > at) out.push({ text: title.slice(at, from), hit: false })
    const last = out[out.length - 1]
    if (last?.hit && from === at) last.text += title.slice(from, e)
    else out.push({ text: title.slice(from, e), hit: true })
    at = e
  }
  if (at < title.length) out.push({ text: title.slice(at), hit: false })
  return out
}

/** A result title with the query's matches in bold. */
export function MatchedTitle({ title, matches }: { title: string; matches: readonly (readonly [number, number])[] }) {
  return (
    <>
      {splitTitle(title, matches).map((p, i) => (p.hit ? <b key={i}>{p.text}</b> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  )
}
