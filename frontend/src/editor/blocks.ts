/**
 * Split a Markdown body into top-level source blocks, keeping each block's
 * exact original text so it can be re-emitted verbatim when unedited.
 *
 * Invariant: `joinBlocks(splitBlocks(body)) === body` for every input,
 * including CRLF / lone-CR line endings, a BOM and a missing final newline.
 */
import { Marked, type TokenizerExtension } from 'marked'

export type SourceBlock = { kind: string; raw: string }

// ---------------------------------------------------------------------------
// Math blocks (M7 rule 6): a line that begins with `$$` (up to 3 spaces of
// indent) starts a math block, which ends at the next line that ends with `$$`
// (trailing blanks allowed); blank lines inside belong to it. `$$x$$` alone on
// a line is a one-line block. Without a closing line it is not a math block.

const MATH_OPEN = /^ {0,3}\$\$/
const MATH_CLOSE = /\$\$[ \t]*$/

/** Length of the math block at the start of `src` (no final line break), or 0. */
function matchMath(src: string): number {
  if (!MATH_OPEN.test(src)) return 0
  let eol = src.indexOf('\n')
  if (eol < 0) eol = src.length
  const first = src.slice(0, eol).replace(/^ +/, '').replace(/[ \t]+$/, '')
  if (first.length >= 4 && first.endsWith('$$')) return eol
  let start = eol + 1
  while (start <= src.length && eol < src.length) {
    eol = src.indexOf('\n', start)
    if (eol < 0) eol = src.length
    if (MATH_CLOSE.test(src.slice(start, eol))) return eol
    start = eol + 1
  }
  return 0
}

/**
 * Math starts in the text being split, found in one pass so that the
 * extension's `start` hook (asked before every paragraph) stays O(log n).
 */
type MathIndex = { text: string; starts: number[]; ends: Map<number, number> }
let mathIndex: MathIndex | null = null

function indexMath(text: string): MathIndex {
  const starts: number[] = []
  const ends = new Map<number, number>()
  if (text.includes('$$')) {
    // Every line start that opens a math block with a closing line after it.
    const opens: number[] = []
    const closes: number[] = [] // line ends of lines that end with `$$`
    let start = 0
    while (start <= text.length) {
      let eol = text.indexOf('\n', start)
      if (eol < 0) eol = text.length
      const line = text.slice(start, eol)
      if (MATH_OPEN.test(line)) opens.push(start)
      if (MATH_CLOSE.test(line)) closes.push(eol)
      if (eol >= text.length) break
      start = eol + 1
    }
    let c = 0
    for (const open of opens) {
      let eol = text.indexOf('\n', open)
      if (eol < 0) eol = text.length
      const first = text.slice(open, eol).replace(/^ +/, '').replace(/[ \t]+$/, '')
      let end = -1
      if (first.length >= 4 && first.endsWith('$$')) end = eol
      else {
        while (c < closes.length && closes[c] <= eol) c++
        if (c < closes.length) end = closes[c]
      }
      if (end >= 0) {
        starts.push(open)
        ends.set(open, end)
      }
    }
  }
  return { text, starts, ends }
}

const mathExtension: TokenizerExtension = {
  name: 'math',
  level: 'block',
  start(src: string) {
    const index = mathIndex
    if (!index || index.starts.length === 0) return undefined
    // `src` is the rest of the text being lexed (nested lexing passes other
    // strings; a stray answer there only cuts a nested paragraph, which never
    // changes a top-level block's raw).
    const abs = index.text.length - src.length
    let lo = 0
    let hi = index.starts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (index.starts[mid] < abs) lo = mid + 1
      else hi = mid
    }
    return lo < index.starts.length ? index.starts[lo] - abs : undefined
  },
  tokenizer(src: string) {
    const index = mathIndex
    let len = 0
    const abs = index ? index.text.length - src.length : -1
    const end = index?.ends.get(abs)
    if (index && end !== undefined && abs >= 0 && src.startsWith(index.text.slice(abs, end))) len = end - abs
    else len = matchMath(src)
    if (!len) return undefined
    const raw = src.slice(0, len)
    return { type: 'math', raw, text: raw }
  },
}

/** A local instance so the app-wide `marked` stays untouched. */
const lexerInstance = new Marked({ gfm: true, extensions: [mathExtension] })

/**
 * `marked` normalises `\r\n` and `\r` to `\n` before lexing, so token `.raw`
 * values are offsets into the normalised text. We lex the normalised text and
 * map each token's span back onto the original string.
 */
export function splitBlocks(body: string): SourceBlock[] {
  if (body === '') return []

  const hasCR = body.includes('\r')
  const normalized = hasCR ? body.replace(/\r\n?/g, '\n') : body
  // origAt[i] = index in `body` of normalised char i (origAt[len] = body.length).
  const origAt = hasCR ? buildOffsetMap(body, normalized.length) : null
  const toOrig = (i: number) => (origAt ? origAt[i] : i)

  const blocks: SourceBlock[] = []
  let pos = 0
  let tokens: { type: string; raw: string }[]
  try {
    mathIndex = indexMath(normalized)
    tokens = lexerInstance.lexer(normalized)
  } catch {
    tokens = []
  } finally {
    mathIndex = null
  }

  for (const token of tokens) {
    if (!token.raw) continue
    if (!normalized.startsWith(token.raw, pos)) break // misaligned: keep the rest as one block
    const end = pos + token.raw.length
    blocks.push({ kind: token.type, raw: body.slice(toOrig(pos), toOrig(end)) })
    pos = end
  }

  if (pos < normalized.length) {
    blocks.push({ kind: 'raw', raw: body.slice(toOrig(pos)) })
  }
  return blocks
}

export function joinBlocks(bs: SourceBlock[]): string {
  return bs.map((b) => b.raw).join('')
}

function buildOffsetMap(body: string, normalizedLength: number): Uint32Array {
  const map = new Uint32Array(normalizedLength + 1)
  let n = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body.charCodeAt(i)
    if (ch === 13 /* \r */ && body.charCodeAt(i + 1) === 10 /* \n */) continue // the \n stands for both
    map[n++] = ch === 10 && i > 0 && body.charCodeAt(i - 1) === 13 ? i - 1 : i
  }
  map[n] = body.length
  return map
}
