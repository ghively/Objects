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

// ---------------------------------------------------------------- tables

const PIPE_SPLIT = /(?<!\\)\|/

type RowStyle = { indent: string; lead: boolean; trail: boolean; pad: string }

function splitCellsRaw(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(PIPE_SPLIT)
}

function isSeparatorCell(c: string): boolean {
  return /^:?-+:?$/.test(c.trim())
}

function tableKey(line: string): string {
  const cells = splitCellsRaw(line).map((c) => c.trim())
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

/** Parse list lines, giving each item a nesting depth from its indent. */
function parseList(lines: string[]): (ListLine | null)[] {
  const stack: number[] = []
  return lines.map((line) => {
    const m = LIST_ITEM.exec(line)
    if (!m) return null
    const w = indentWidth(m[1])
    while (stack.length && w < stack[stack.length - 1]) stack.pop()
    if (!stack.length || w > stack[stack.length - 1]) stack.push(w)
    return { indent: m[1], marker: m[2], gap: m[3], content: m[4], depth: stack.length - 1 }
  })
}

function listKey(line: string, parsed: ListLine | null): string {
  if (!parsed) return 'C\0' + line.trim()
  const ordered = /\d/.test(parsed.marker) ? 'o' : 'b'
  return `I\0${parsed.depth}\0${ordered}\0${parsed.content.trimEnd()}`
}

function preserveList(origLines: string[], regenLines: string[]): string[] {
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
    if (!p) return line
    const indent = indentByDepth.get(p.depth) ?? unit.repeat(p.depth)
    const ordered = /\d/.test(p.marker)
    let marker = p.marker
    if (ordered && delimiter) marker = (repeated ?? p.marker.slice(0, -1)) + delimiter
    else if (!ordered && firstBullet) marker = firstBullet.marker
    const gap = p.content === '' ? '' : firstBullet && !ordered ? firstBullet.gap || ' ' : p.gap || ' '
    return indent + marker + gap + p.content
  }

  const match = alignMatch(
    origLines.map((l, i) => listKey(l, origParsed[i])),
    regenLines.map((l, i) => listKey(l, regenParsed[i])),
  )
  return weaveBlankLines(origLines, regenLines, match, restyle)
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
  if (o === r) return true
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
  if ((kind === 'table' || kind === 'list') && origBody !== '') {
    lines = kind === 'table' ? preserveTable(origLines, regenLines) : preserveList(origLines, regenLines)
  } else if (origBody !== '' && (origLines.length > 1 || regenLines.length > 1)) {
    lines = preserveLines(origLines, regenLines, baseline)
  } else {
    lines = regenLines
  }
  return lines.join(eol) + tail
}

/**
 * Any other multi-line block: keep each original line whose regenerated line
 * is unchanged. With a `baseline` that has one line per original line, a
 * regenerated line equal to baseline line i stands for original line i (so an
 * untouched line keeps its own `_em_` style and escaping); otherwise only
 * lines that come back identical are kept. The key is the exact serialized
 * line, so an edit that only adds or removes markup still counts as an edit.
 */
function preserveLines(origLines: string[], regenLines: string[], baseline?: string): string[] {
  const baseLines = baseline === undefined ? null : splitTail(toLF(baseline))[0].split('\n')
  const origKeys = baseLines && baseLines.length === origLines.length ? baseLines : origLines
  return alignLines(
    origLines,
    regenLines,
    origKeys.map((l) => l.trimEnd()),
    regenLines.map((l) => l.trimEnd()),
    (line) => line,
  )
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
      else if (!endsBlank && (prev.raw === undefined || block.raw === undefined)) out += eol
    }
    out += text
    prev = block
  }
  return out
}
