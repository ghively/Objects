/**
 * Re-emit edited Markdown while preserving the original bytes wherever the
 * content is unchanged.
 *
 * - Whole block: if the regenerated Markdown normalises to the same thing as
 *   the original, the original text is returned untouched.
 * - Tables and lists: line alignment (LCS over normalised line keys). Every
 *   original line whose content still appears is kept verbatim; changed lines
 *   take the regenerated text restyled to the original's bullet character,
 *   ordered-list delimiter, indent width and table cell padding. A loose list
 *   keeps the blank lines between its items.
 * - Other multi-line blocks (paragraphs, quotes, code): line alignment against
 *   the block's baseline, i.e. what the serializer emitted for the unedited
 *   block. A regenerated line equal to its baseline line was not edited, so the
 *   original line is kept (with its own emphasis style and escaping).
 * - The original's line ending (LF/CRLF) and trailing newlines are kept.
 */

import { splitBlocks } from './blocks'

export type EditorBlock = {
  raw?: string
  markdown: string
  kind: string
  /** The serializer's output for the unedited `raw` (see `preserveBlock`). */
  baseline?: string
}

// ---------------------------------------------------------------- helpers

function eolOf(s: string): string {
  return s.includes('\r\n') ? '\r\n' : '\n'
}

function toLF(s: string): string {
  return s.replace(/\r\n?/g, '\n')
}

/** Split off trailing line endings: `[content, tail]`. */
function splitTail(s: string): [string, string] {
  const m = /(?:\r?\n|\r)+$/.exec(s)
  return m ? [s.slice(0, m.index), m[0]] : [s, '']
}

function genericNorm(s: string): string {
  return toLF(s)
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * LF line ends, no leading or trailing line breaks, and no trailing blanks on
 * the last line (they mean nothing there); every other blank kept.
 */
function exactNorm(s: string): string {
  return toLF(s)
    .replace(/^\n+|\n+$/g, '')
    .replace(/[ \t]+$/, '')
}

// ---------------------------------------------------------------- tables

type RowStyle = { indent: string; lead: boolean; trail: boolean; pad: string }

/**
 * The cells of a row: split at every `|` that is neither escaped nor inside a
 * code span (the serializer writes such a pipe `\|`, as GFM asks; a file may
 * hold it bare, and the parser reads both as one cell).
 */
function splitCellsRaw(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let start = 0
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') i += 2
    else if (ch === '`') {
      // A code span runs to the next backtick run of the same length (or the line end).
      let n = 1
      while (s[i + n] === '`') n++
      const close = s.indexOf('`'.repeat(n), i + n)
      i = close < 0 ? s.length : close + n
    } else if (ch === '|') {
      cells.push(s.slice(start, i))
      start = ++i
    } else i++
  }
  cells.push(s.slice(start))
  return cells
}

function isSeparatorCell(c: string): boolean {
  return /^:?-+:?$/.test(c.trim())
}

function tableKey(line: string): string {
  // `\|` and a bare pipe inside a code span are the same cell text.
  const cells = splitCellsRaw(line).map((c) => c.trim().replace(/\\\|/g, '|'))
  if (cells.length > 0 && cells.every(isSeparatorCell)) {
    return (
      'S\0' +
      cells.map((c) => (c.startsWith(':') ? ':' : '') + '-' + (c.endsWith(':') ? ':' : '')).join('|')
    )
  }
  return 'R\0' + cells.join('\0')
}

function rowStyle(line: string): RowStyle {
  const indent = /^\s*/.exec(line)![0]
  const t = line.trim()
  const cells = splitCellsRaw(line)
  const pad = cells.some((c) => /^ +\S/.test(c) || /\S +$/.test(c)) ? ' ' : ''
  return { indent, lead: t.startsWith('|'), trail: t.endsWith('|') && !t.endsWith('\\|'), pad }
}

/** Raw cell widths per column, if every original row agrees (an aligned table). */
function alignedWidths(lines: string[]): number[] | null {
  let widths: number[] | null = null
  for (const line of lines) {
    const w = splitCellsRaw(line).map((c) => c.length)
    if (!widths) widths = w
    else if (w.length !== widths.length || w.some((x, i) => x !== widths![i])) return null
  }
  return widths && lines.length > 1 ? widths : null
}

function restyleTableRow(regenLine: string, style: RowStyle, widths: number[] | null): string {
  const cells = splitCellsRaw(regenLine).map((c) => c.trim())
  const sep = cells.every(isSeparatorCell)
  const out = cells.map((c, i) => {
    const w = widths && widths.length === cells.length ? widths[i] - 2 * style.pad.length : 0
    if (sep) {
      const left = c.startsWith(':') ? ':' : ''
      const right = c.endsWith(':') ? ':' : ''
      const dashes = w > 0 ? Math.max(1, w - left.length - right.length) : 3
      return style.pad + left + '-'.repeat(dashes) + right + style.pad
    }
    return style.pad + (w > c.length ? c.padEnd(w) : c) + style.pad
  })
  return style.indent + (style.lead ? '|' : '') + out.join('|') + (style.trail ? '|' : '')
}

function preserveTable(origLines: string[], regenLines: string[]): string[] {
  const origCols = splitCellsRaw(origLines[0] ?? '').length
  const regenCols = splitCellsRaw(regenLines[0] ?? '').length
  if (origCols !== regenCols) return regenLines // column added/removed: rewrite (allowed)

  const style = rowStyle(origLines[0])
  const widths = alignedWidths(origLines)
  return alignLines(
    origLines,
    regenLines,
    origLines.map(tableKey),
    regenLines.map(tableKey),
    (line) => restyleTableRow(line, style, widths),
  )
}

// ---------------------------------------------------------------- lists

const LIST_ITEM = /^([ \t]*)([*+-]|\d{1,9}[.)])([ \t]+|$)(.*)$/

type ListLine = { indent: string; marker: string; gap: string; content: string; depth: number }

function indentWidth(ws: string): number {
  let w = 0
  for (const ch of ws) w = ch === '\t' ? w + 4 - (w % 4) : w + 1
  return w
}

/**
 * Parse list lines, giving each item a nesting depth as CommonMark does: an
 * item is nested in the previous one when its indent reaches that item's
 * content column (indent, marker and gap; a tab is four columns), so `   - b`
 * and `\t- c` are siblings.
 */
function parseList(lines: string[]): (ListLine | null)[] {
  const columns: number[] = [] // content column of the open item at each depth
  return lines.map((line) => {
    const m = LIST_ITEM.exec(line)
    if (!m) return null
    const w = indentWidth(m[1])
    while (columns.length && w < columns[columns.length - 1]) columns.pop()
    const depth = columns.length
    columns.push(indentWidth(m[1] + m[2] + (m[3] || ' ')))
    return { indent: m[1], marker: m[2], gap: m[3], content: m[4], depth }
  })
}

function listKey(line: string, parsed: ListLine | null): string {
  if (!parsed) return 'C\0' + line.trim()
  const ordered = /\d/.test(parsed.marker) ? 'o' : 'b'
  // A hard break may be written `\` or as trailing blanks, and a done box `[x]` or `[X]`: the same line.
  const content = parsed.content.replace(/^\[X\](?=[ \t]|$)/, '[x]')
  return `I\0${parsed.depth}\0${ordered}\0${content.replace(/\\$/, '').trimEnd()}`
}

/** A quote line inside a list item: not an item, and `>` after its indent. */
const quoteInItem = (line: string, parsed: ListLine | null): boolean => !parsed && /^[ \t]*>/.test(line)

/** The runs of consecutive quote lines inside items, as [start, end) line ranges. */
function quoteRuns(lines: string[], parsed: (ListLine | null)[]): [number, number][] {
  const runs: [number, number][] = []
  for (let i = 0; i < lines.length; i++) {
    if (!quoteInItem(lines[i], parsed[i])) continue
    let end = i + 1
    while (end < lines.length && quoteInItem(lines[end], parsed[end])) end++
    runs.push([i, end])
    i = end - 1
  }
  return runs
}

/**
 * Quotes inside list items get the same care as top-level ones (`preserveQuote`): the
 * serializer's own layout (a bare `>` line before a nested quote, a lazy line written with
 * the inner quote's markers) is replaced by the original's where the text is the same.
 * The n-th quote of the regenerated list is paired with the n-th of the original when both
 * have as many; the indent shared by a quote's lines is set aside meanwhile.
 */
function keepQuotesInItems(origLines: string[], regenLines: string[]): string[] {
  const origRuns = quoteRuns(origLines, parseList(origLines))
  const regenRuns = quoteRuns(regenLines, parseList(regenLines))
  if (origRuns.length === 0 || origRuns.length !== regenRuns.length) return regenLines
  const commonIndent = (lines: string[]): string => {
    let indent = /^[ \t]*/.exec(lines[0])![0]
    for (const l of lines) while (!l.startsWith(indent)) indent = indent.slice(0, -1)
    return indent
  }
  const out: string[] = []
  let at = 0
  regenRuns.forEach(([start, end], n) => {
    const orig = origLines.slice(origRuns[n][0], origRuns[n][1])
    const regen = regenLines.slice(start, end)
    const oi = commonIndent(orig)
    const ri = commonIndent(regen)
    const kept = preserveQuote(
      orig.map((l) => l.slice(oi.length)),
      regen.map((l) => l.slice(ri.length)),
    )
    out.push(...regenLines.slice(at, start), ...kept.map((l) => oi + l))
    at = end
  })
  out.push(...regenLines.slice(at))
  return out
}

function preserveList(origLines: string[], regenInput: string[]): string[] {
  const regenLines = keepQuotesInItems(origLines, regenInput)
  const origParsed = parseList(origLines)
  const regenParsed = parseList(regenLines)

  // Original style: bullet char, gap after the marker, indent per depth,
  // ordered delimiter ('.' or ')') and a repeated number ('1.' on every item).
  const firstBullet = origParsed.find((p) => p && !/\d/.test(p.marker))
  const origOrdered = origParsed.filter((p): p is ListLine => !!p && /\d/.test(p.marker))
  const delimiter = origOrdered[0]?.marker.slice(-1)
  const repeated =
    origOrdered.length > 1 && origOrdered.every((p) => p.marker === origOrdered[0].marker)
      ? origOrdered[0].marker.slice(0, -1)
      : null
  const indentByDepth = new Map<number, string>()
  for (const p of origParsed) if (p && !indentByDepth.has(p.depth)) indentByDepth.set(p.depth, p.indent)
  const unit =
    indentByDepth.get(1) ??
    regenParsed.find((p) => p && p.depth === 1)?.indent ??
    '    '

  const restyle = (line: string, i: number): string => {
    const p = regenParsed[i]
    if (!p) return continuation(line, i)
    const indent = indentByDepth.get(p.depth) ?? unit.repeat(p.depth)
    const ordered = /\d/.test(p.marker)
    let marker = p.marker
    if (ordered && delimiter) marker = (repeated ?? p.marker.slice(0, -1)) + delimiter
    else if (!ordered && firstBullet) marker = firstBullet.marker
    const gap = p.content === '' ? '' : firstBullet && !ordered ? firstBullet.gap || ' ' : p.gap || ' '
    return indent + marker + gap + p.content
  }

  // A continuation line of an item (after a hard break) keeps the indent of
  // the original continuation line it replaces (none on a lazy one); a new one
  // is indented to its item's text as written in the output (the serializer
  // leaves it short).
  const continuation = (line: string, i: number): string => {
    if (line.trim() === '') return line
    const first = firstParagraphItem(i)
    if (first >= 0) return firstParagraphLine(line, i, first)
    const replaced = replacedOriginal(i)
    if (replaced !== null && !origParsed[replaced])
      return /^[ \t]*/.exec(origLines[replaced])![0] + line.trimStart()
    let k = i - 1
    while (k >= 0 && !regenParsed[k]) k--
    if (k < 0) return line
    const q = regenParsed[k]!
    const item = LIST_ITEM.exec(match[k] >= 0 ? origLines[match[k]] : restyle(regenLines[k], k))
    if (!item) return line
    const col = item[1].length + item[2].length + item[3].length
    const regenCol = q.indent.length + q.marker.length + q.gap.length
    const own = /^[ \t]*/.exec(line)![0].length
    return ' '.repeat(col + Math.max(0, own - regenCol)) + line.trimStart()
  }

  /** For a line after a hard break in an item's first paragraph, that item's line; else -1. */
  const firstParagraphItem = (i: number): number => {
    for (let k = i - 1; k >= 0 && HARD_BREAK.test(regenLines[k]); k--) if (regenParsed[k]) return k
    return -1
  }

  // A line after a hard break in an item's first paragraph. The serializer
  // indents it by the item's indent only, so blanks beyond that are the text's
  // own (a line typed after Shift-Enter that starts with spaces). The loader
  // strips the item's indent and two columns (an ordered item's: its marker's
  // width, `10.` three) and keeps further blanks as text,
  // except four or more (or a tab), which it drops: their first is written
  // `&nbsp;`, as on a paragraph's first line (`escapeLineStarts`). An original
  // line whose blanks read back as the same text keeps them.
  const firstParagraphLine = (line: string, i: number, first: number): string => {
    const lead = /^[ \t]*/.exec(line)![0]
    const text = lead.slice(Math.min(lead.length, regenParsed[first]!.indent.length))
    const item = LIST_ITEM.exec(match[first] >= 0 ? origLines[match[first]] : restyle(regenLines[first], first))
    const marker = item ? item[2] : regenParsed[first]!.marker
    const indent = (item ? item[1] : regenParsed[first]!.indent) + ' '.repeat(/\d/.test(marker) ? marker.length : 2)
    const replaced = replacedOriginal(i)
    if (replaced !== null && !origParsed[replaced]) {
      const origLead = /^[ \t]*/.exec(origLines[replaced])![0]
      const same = text === '' ? origLead.length <= indent.length : origLead.length - indent.length === text.length
      if (same && !/\t/.test(origLead + text)) return origLead + line.trimStart()
    }
    if (text.length >= 4 || text.includes('\t')) return indent + '&nbsp;' + text.slice(1) + line.trimStart()
    return indent + text + line.trimStart()
  }

  /** The original line regenerated line `i` replaces, as `weaveBlankLines` pairs them, or null. */
  const replacedOriginal = (i: number): number | null => {
    let p = i - 1
    while (p >= 0 && match[p] < 0) p--
    let o = p >= 0 ? match[p] : -1
    for (let n = p + 1; n <= i; n++) {
      o++
      while (o < origLines.length && isBlank(origLines[o])) o++
    }
    let next = i + 1
    while (next < regenLines.length && match[next] < 0) next++
    const limit = next < regenLines.length ? match[next] : origLines.length
    return o < limit ? o : null
  }

  const match = alignMatch(
    origLines.map((l, i) => listKey(l, origParsed[i])),
    regenLines.map((l, i) => listKey(l, regenParsed[i])),
  )
  // The key ignores a hard break, so a Shift-Enter typed at the end of an
  // unchanged item still matches its original line: that line takes the
  // regenerated ending (restyled), or the break would be saved as a soft one.
  const kept = origLines.slice()
  match.forEach((o, k) => {
    if (o >= 0 && HARD_BREAK.test(regenLines[k]) && !HARD_BREAK.test(origLines[o])) kept[o] = restyle(regenLines[k], k)
  })
  return keepListStarts(weaveBlankLines(kept, regenLines, match, restyle), regenParsed)
}

/** A line ending in a hard break: two or more blanks, or a backslash. */
const HARD_BREAK = /(?:[ \t]{2,}|\\)$/

/** Line index and number of the first item of each ordered list (CommonMark: its start). */
function orderedStarts(parsed: (ListLine | null)[]): [number, string][] {
  const out: [number, string][] = []
  const kindAt: boolean[] = [] // per depth: was the last item there ordered?
  parsed.forEach((p, i) => {
    if (!p) return
    kindAt.length = p.depth + 1
    const ordered = /\d/.test(p.marker)
    if (ordered && kindAt[p.depth] !== true) out.push([i, p.marker.slice(0, -1)])
    kindAt[p.depth] = ordered
  })
  return out
}

/**
 * A kept original line can become the first item of an ordered list (the item
 * before it was deleted): its number is the list's start, so it takes the
 * number the editor shows (the regenerated one) instead of its old one.
 */
function keepListStarts(out: string[], regenParsed: (ListLine | null)[]): string[] {
  const want = orderedStarts(regenParsed)
  const have = orderedStarts(parseList(out))
  if (want.length !== have.length) return out
  const fixed = out.slice()
  have.forEach(([i, num], k) => {
    const start = want[k][1]
    if (num === start) return
    const m = LIST_ITEM.exec(fixed[i])!
    fixed[i] = m[1] + start + m[2].slice(-1) + fixed[i].slice(m[1].length + m[2].length)
  })
  return fixed
}

const isBlank = (line: string) => line.trim() === ''

/**
 * Emit the aligned lines, putting back the original's blank lines that the
 * regenerated (tight) list dropped. Between two kept original lines, the
 * original lines in between are replayed in order: blank ones as they were,
 * the others replaced one-for-one by the unmatched regenerated lines there
 * (extra regenerated lines follow; extra original lines were deleted).
 */
function weaveBlankLines(
  origLines: string[],
  regenLines: string[],
  match: Int32Array,
  restyle: (line: string, index: number) => string,
): string[] {
  const out: string[] = []
  const last = () => out[out.length - 1]
  const pushBlank = (line: string) => {
    // No blank first line, and no stacked blanks where an item was removed.
    if (out.length > 0 && !isBlank(last())) out.push(line)
  }
  let prevOrig = -1
  let j = 0
  for (;;) {
    // The run of unmatched regenerated lines up to the next match (or the end).
    let k = j
    while (k < regenLines.length && match[k] < 0) k++
    const nextOrig = k < regenLines.length ? match[k] : origLines.length
    const pending = regenLines.slice(j, k).map((line, n) => restyle(line, j + n))
    let p = 0
    for (let i = prevOrig + 1; i < nextOrig; i++) {
      if (isBlank(origLines[i])) pushBlank(origLines[i])
      else if (p < pending.length) out.push(pending[p++])
    }
    while (p < pending.length) out.push(pending[p++])
    if (k >= regenLines.length) break
    const kept = origLines[match[k]]
    if (isBlank(kept)) pushBlank(kept)
    else out.push(kept)
    prevOrig = match[k]
    j = k + 1
  }
  // A blank line only goes back between two lines, never at the end.
  while (out.length > 0 && isBlank(last())) out.pop()
  return out
}

// ---------------------------------------------------------------- alignment

/**
 * LCS alignment over line keys. Matched regenerated lines are replaced by
 * their original line; the rest are restyled.
 */
function alignLines(
  origLines: string[],
  regenLines: string[],
  origKeys: string[],
  regenKeys: string[],
  restyle: (line: string, index: number) => string,
): string[] {
  const match = alignMatch(origKeys, regenKeys)
  return regenLines.map((line, j) => (match[j] >= 0 ? origLines[match[j]] : restyle(line, j)))
}

/** LCS over line keys: for each regenerated line, the original line it matches, or -1. */
function alignMatch(origKeys: string[], regenKeys: string[]): Int32Array {
  const n = origKeys.length
  const m = regenKeys.length
  // Trim a common prefix and suffix first: a one-line edit in a big table is O(n).
  let lo = 0
  while (lo < n && lo < m && origKeys[lo] === regenKeys[lo]) lo++
  let hiO = n
  let hiR = m
  while (hiO > lo && hiR > lo && origKeys[hiO - 1] === regenKeys[hiR - 1]) {
    hiO--
    hiR--
  }

  const match = new Int32Array(m).fill(-1) // regen index -> orig index
  for (let i = 0; i < lo; i++) match[i] = i
  for (let k = 0; k < m - hiR; k++) match[hiR + k] = hiO + k

  const a = hiO - lo
  const b = hiR - lo
  if (a > 0 && b > 0) {
    const dp = new Uint32Array((a + 1) * (b + 1))
    const W = b + 1
    for (let i = a - 1; i >= 0; i--) {
      for (let j = b - 1; j >= 0; j--) {
        dp[i * W + j] =
          origKeys[lo + i] === regenKeys[lo + j]
            ? dp[(i + 1) * W + j + 1] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < a && j < b) {
      if (origKeys[lo + i] === regenKeys[lo + j]) {
        match[lo + j] = lo + i
        i++
        j++
      } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++
      else j++
    }
  }
  return match
}

// ---------------------------------------------------------------- public API

function blockKeysEqual(original: string, regenerated: string, kind: string): boolean {
  const o = genericNorm(original)
  const r = genericNorm(regenerated)
  // Outside tables and lists trailing blanks count (except on the last line):
  // an edit may add only those (spaces in a code line, a hard break where a
  // line break was).
  if (o === r) return kind === 'table' || kind === 'list' || exactNorm(original) === exactNorm(regenerated)
  if (kind === 'table') {
    const ol = o.split('\n')
    const rl = r.split('\n')
    return ol.length === rl.length && ol.every((l, i) => tableKey(l) === tableKey(rl[i]))
  }
  if (kind === 'list') {
    const ol = o.split('\n')
    const rl = r.split('\n')
    if (ol.length !== rl.length) return false
    const op = parseList(ol)
    const rp = parseList(rl)
    return ol.every((l, i) => listKey(l, op[i]) === listKey(rl[i], rp[i]))
  }
  return false
}

/**
 * `fallbackEol` is the document's line ending, used when `original` has no
 * line break of its own (a one-line block's `raw` usually has none), so an
 * edit that adds lines keeps the document's CRLF.
 */
export function preserveBlock(
  original: string,
  regenerated: string,
  kind: string,
  fallbackEol?: string,
  baseline?: string,
): string {
  if (blockKeysEqual(original, regenerated, kind)) return original

  const eol = /[\r\n]/.test(original) ? eolOf(original) : (fallbackEol ?? '\n')
  const [origBody, tail] = splitTail(original)
  const [regenBody] = splitTail(toLF(regenerated))
  const regenLines = regenBody.split('\n')

  let lines: string[]
  const origLines = origBody.split(/\r\n|\n|\r/)
  const fenced = kind === 'code' ? preserveFenced(origLines, regenLines, baseline) : null
  if (fenced) {
    lines = fenced
  } else if ((kind === 'table' || kind === 'list') && origBody !== '') {
    lines = kind === 'table' ? preserveTable(origLines, regenLines) : preserveList(origLines, regenLines)
  } else if (origBody !== '' && (origLines.length > 1 || regenLines.length > 1)) {
    lines = preserveLines(origLines, regenLines, baseline, kind)
  } else {
    lines = regenLines
  }
  return lines.join(eol) + tail
}

// ---------------------------------------------------------------- code fences

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})(.*)$/

/**
 * The fence for a code block's `text`: three of `char` (a backtick or a tilde),
 * or one more than the longest run of that character that starts a line inside
 * (CommonMark: such a line would otherwise close the block early). Backticks
 * inside a tilde fence, and tildes inside a backtick fence, are plain text.
 */
export function codeFence(text: string, char = '`'): string {
  let longest = 0
  const run = new RegExp(`^ {0,3}(${char === '`' ? '`' : '~'}{3,})`, 'gm')
  for (const m of text.matchAll(run)) longest = Math.max(longest, m[1].length)
  return char.repeat(Math.max(3, longest + 1))
}

/**
 * A fenced code block keeps its original fence character (the serializer
 * always writes backticks), its indent and info string, and its fence length
 * unless a line typed inside would close it; only the inner lines are aligned.
 * Null when the original is not a fenced block (an indented one, or a block
 * whose source no longer looks like code).
 */
function preserveFenced(origLines: string[], regenLines: string[], baseline?: string): string[] | null {
  const open = FENCE_LINE.exec(origLines[0] ?? '')
  const regenOpen = FENCE_LINE.exec(regenLines[0] ?? '')
  if (!open || !regenOpen || regenLines.length < 2 || !FENCE_LINE.test(regenLines[regenLines.length - 1])) return null
  const char = open[2][0]
  // The original's closing fence: same character, at least as long as the opening one.
  const closeLine = origLines.length > 1 ? FENCE_LINE.exec(origLines[origLines.length - 1]) : null
  const close = closeLine && closeLine[2][0] === char && closeLine[2].length >= open[2].length && closeLine[3].trim() === '' ? closeLine : null
  const origInner = origLines.slice(1, close ? -1 : undefined)
  const regenInner = regenLines.slice(1, -1)

  const baseLines = baseline === undefined ? null : splitTail(toLF(baseline))[0].split('\n')
  const baseInner = baseLines && baseLines.length === origLines.length && close ? baseLines.slice(1, -1).join('\n') : undefined
  const inner = origInner.length ? preserveLines(origInner, regenInner, baseInner) : regenInner

  // Keep the original fence runs unless an inner line would now close the block.
  const needed = codeFence(inner.join('\n'), char).length
  const openRun = char.repeat(Math.max(open[2].length, needed))
  const info = open[3].trim() === regenOpen[3].trim() ? open[3] : regenOpen[3]
  const closeRun = close ? char.repeat(Math.max(close[2].length, needed)) : openRun
  const closeIndent = close ? close[1] : open[1]
  return [open[1] + openRun + info, ...inner, closeIndent + closeRun]
}

/**
 * Any other multi-line block: keep each original line whose regenerated line
 * is unchanged. With a `baseline` that has one line per original line, a
 * regenerated line equal to baseline line i stands for original line i (so an
 * untouched line keeps its own `_em_` style and escaping); otherwise only
 * lines that come back identical are kept. The key is the exact serialized
 * line, so an edit that only adds or removes markup still counts as an edit.
 */
const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*/

function preserveLines(origLines: string[], regenLines: string[], baseline?: string, kind?: string): string[] {
  const baseLines = baseline === undefined ? null : splitTail(toLF(baseline))[0].split('\n')
  // Against the baseline (the serializer's own output) lines compare exactly,
  // so an edit adding only trailing blanks or a hard break counts; against
  // the original, its trailing blanks are ignored.
  if (baseLines && baseLines.length === origLines.length) {
    // An edited line keeps its original's quote markers (none on a lazy
    // continuation line, `>` without the space, ...) in place of the baseline's.
    const sameCount = regenLines.length === origLines.length
    const restyle = (line: string, j: number) => {
      if (!sameCount) return line
      const base = QUOTE_PREFIX.exec(baseLines[j])![0]
      if (base === '' || !line.startsWith(base)) return line
      return QUOTE_PREFIX.exec(origLines[j])![0] + line.slice(base.length)
    }
    return alignLines(origLines, regenLines, baseLines, regenLines, restyle)
  }
  if (kind === 'blockquote') return preserveQuote(origLines, regenLines)
  const key = (l: string) => l.trimEnd()
  return alignLines(origLines, regenLines, origLines.map(key), regenLines.map(key), (line) => line)
}

/** A quote line with only markers: a blank line inside the quote. */
const bareQuote = (line: string): boolean => line.replace(QUOTE_PREFIX, '').trim() === ''
/** The number of `>` markers a line starts with. */
const quoteDepth = (line: string): number => (QUOTE_PREFIX.exec(line)![0].match(/>/g) ?? []).length
const quoteKey = (line: string): string => line.replace(QUOTE_PREFIX, '').trimEnd()
/** A quote line a lazy line after it continues: paragraph text, not a blank, heading, fence, item or table row. */
const continuesParagraph = (line: string): boolean =>
  !/^(?:$|#{1,6}(?:\s|$)|`{3}|~{3}|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|\||<)/.test(line.replace(QUOTE_PREFIX, '').trim())

/**
 * A quote the serializer lays out on other lines than the original (a nested
 * quote's lazy line `> c` written `> > c`, a `>` line added between blocks):
 * lines compare by their text, so the untouched ones keep their markers.
 * - A bare `>` line the serializer puts before a deeper nested quote, or after
 *   a heading, where the original had none, is dropped: the nested quote
 *   interrupts the paragraph above it anyway (`> a` then `> > b`), and a
 *   heading is one line.
 * - An edited line that takes an original line's place keeps that line's
 *   markers when they read the same: as many (only their spacing differs), or
 *   fewer on a lazy continuation of the paragraph above it.
 */
function preserveQuote(origLines: string[], regenLines: string[]): string[] {
  const origKeys = origLines.map(quoteKey)
  let match = alignMatch(origKeys, regenLines.map(quoteKey))
  const lines = regenLines.filter((line, j) => {
    if (!bareQuote(line) || match[j] >= 0 || j === 0 || j + 1 >= regenLines.length) return true
    const prev = regenLines[j - 1]
    const next = regenLines[j + 1]
    if (bareQuote(prev) || bareQuote(next)) return true
    const heading = /^#{1,6}(?:\s|$)/.test(prev.replace(QUOTE_PREFIX, '').trim())
    if (quoteDepth(next) <= quoteDepth(prev) && !(heading && quoteDepth(next) === quoteDepth(prev))) return true
    // The original's two lines on either side, if it had them adjacent (no blank between).
    const at = match[j - 1] >= 0 ? match[j - 1] + 1 : match[j + 1] >= 0 ? match[j + 1] : -1
    return !(at > 0 && at < origLines.length && !bareQuote(origLines[at]) && !bareQuote(origLines[at - 1]))
  })
  if (lines.length !== regenLines.length) match = alignMatch(origKeys, lines.map(quoteKey))

  // Pair the edited lines with the original lines they replace, gap by gap.
  const replaces = new Int32Array(lines.length).fill(-1)
  let o = 0
  let r = 0
  for (let j = 0; j <= lines.length; j++) {
    if (j < lines.length && match[j] < 0) continue
    const oEnd = j < lines.length ? match[j] : origLines.length
    if (oEnd - o === j - r) for (let n = 0; n < j - r; n++) replaces[r + n] = o + n
    o = oEnd + 1
    r = j + 1
  }
  return lines.map((line, j) => {
    if (match[j] >= 0) return origLines[match[j]]
    const orig = replaces[j] >= 0 ? origLines[replaces[j]] : null
    if (orig === null || bareQuote(orig) || bareQuote(line)) return line
    const depth = quoteDepth(line)
    const origDepth = quoteDepth(orig)
    const lazy = origDepth < depth && j > 0 && continuesParagraph(lines[j - 1]) && quoteDepth(lines[j - 1]) === depth
    if (origDepth !== depth && !lazy) return line
    return QUOTE_PREFIX.exec(orig)![0] + line.slice(QUOTE_PREFIX.exec(line)![0].length)
  })
}

/**
 * Serialize the editor's top-level blocks. Blocks with `raw` come from
 * `splitBlocks` and are preserved via `preserveBlock`; blocks without `raw`
 * are new and emitted as their Markdown. `space` blocks may be passed through
 * or dropped: when two content blocks meet without one, a blank line is
 * inserted unless both came from the source and the first already ends with
 * a line break (they were adjacent in the original, e.g. a heading then a
 * paragraph). `docEol` is the document's line ending when the caller knows it
 * (M7: a container's children, where no block may carry a line break of its
 * own); otherwise it is taken from the first `raw` holding a CRLF.
 */
export function serializeWithPreservation(blocks: EditorBlock[], docEol?: string): string {
  const eol = docEol ?? (blocks.find((b) => b.raw?.includes('\r\n')) ? '\r\n' : '\n')
  let out = ''
  let prev: EditorBlock | null = null
  let prevText = ''
  for (const block of blocks) {
    let text: string
    if (block.raw !== undefined) text = preserveBlock(block.raw, block.markdown, block.kind, eol, block.baseline)
    else text = eol === '\n' ? block.markdown : toLF(block.markdown).replace(/\n/g, eol)
    if (text === '') continue

    if (prev && prev.kind !== 'space' && block.kind !== 'space' && out !== '') {
      const endsBreak = /(\r?\n|\r)$/.test(out)
      // On LF-normalised text: a lone CRLF is one line break, not a blank line.
      const endsBlank = /\n[ \t]*\n$/.test(toLF(out.slice(-256)))
      if (!endsBreak) out += eol + eol
      else if (!endsBlank && (prev.raw === undefined || block.raw === undefined || !staysApart(prevText, text)))
        out += eol
    }
    out += text
    prev = block
    prevText = text
  }
  return out
}

/**
 * True when `a` directly followed by `b` (no blank line) still reads as the
 * two blocks, e.g. a heading then a paragraph. Two source blocks that were
 * adjacent in the original pass; blocks brought together by a move (two
 * paragraphs) do not, and get a blank line between them.
 */
function staysApart(a: string, b: string): boolean {
  let at = 0
  for (const block of splitBlocks(a + b)) {
    at += block.raw.length
    if (at === a.length) return true
    if (at > a.length) return false
  }
  return false
}
