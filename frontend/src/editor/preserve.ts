/**
 * Re-emit edited Markdown while preserving the original bytes wherever the
 * content is unchanged.
 *
 * - Whole block: if the regenerated Markdown normalises to the same thing as
 *   the original, the original text is returned untouched.
 * - Tables and lists: line alignment (LCS over normalised line keys). Every
 *   original line whose content still appears is kept verbatim; changed lines
 *   take the regenerated text restyled to the original's bullet character,
 *   indent width and table cell padding.
 * - The original's line ending (LF/CRLF) and trailing newlines are kept.
 */

export type EditorBlock = { raw?: string; markdown: string; kind: string }

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

  // Original style: bullet char, gap after the marker, indent per depth.
  const firstBullet = origParsed.find((p) => p && !/\d/.test(p.marker))
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
    const marker = ordered || !firstBullet ? p.marker : firstBullet.marker
    const gap = p.content === '' ? '' : firstBullet && !ordered ? firstBullet.gap || ' ' : p.gap || ' '
    return indent + marker + gap + p.content
  }

  return alignLines(
    origLines,
    regenLines,
    origLines.map((l, i) => listKey(l, origParsed[i])),
    regenLines.map((l, i) => listKey(l, regenParsed[i])),
    restyle,
  )
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

  return regenLines.map((line, j) => (match[j] >= 0 ? origLines[match[j]] : restyle(line, j)))
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
): string {
  if (blockKeysEqual(original, regenerated, kind)) return original

  const eol = /[\r\n]/.test(original) ? eolOf(original) : (fallbackEol ?? '\n')
  const [origBody, tail] = splitTail(original)
  const [regenBody] = splitTail(toLF(regenerated))
  const regenLines = regenBody.split('\n')

  let lines: string[]
  if ((kind === 'table' || kind === 'list') && origBody !== '') {
    const origLines = origBody.split(/\r\n|\n|\r/)
    lines = kind === 'table' ? preserveTable(origLines, regenLines) : preserveList(origLines, regenLines)
  } else {
    lines = regenLines
  }
  return lines.join(eol) + tail
}

/**
 * Serialize the editor's top-level blocks. Blocks with `raw` come from
 * `splitBlocks` and are preserved via `preserveBlock`; blocks without `raw`
 * are new and emitted as their Markdown. `space` blocks may be passed through
 * or dropped: when two content blocks meet without one, a blank line is
 * inserted unless both came from the source and the first already ends with
 * a line break (they were adjacent in the original, e.g. a heading then a
 * paragraph).
 */
export function serializeWithPreservation(blocks: EditorBlock[]): string {
  const eol = blocks.find((b) => b.raw?.includes('\r\n')) ? '\r\n' : '\n'
  let out = ''
  let prev: EditorBlock | null = null
  for (const block of blocks) {
    let text: string
    if (block.raw !== undefined) text = preserveBlock(block.raw, block.markdown, block.kind, eol)
    else text = eol === '\n' ? block.markdown : toLF(block.markdown).replace(/\n/g, eol)
    if (text === '') continue

    if (prev && prev.kind !== 'space' && block.kind !== 'space' && out !== '') {
      const endsBreak = /(\r?\n|\r)$/.test(out)
      const endsBlank = /(\r?\n|\r)[ \t]*(\r?\n|\r)$/.test(out)
      if (!endsBreak) out += eol + eol
      else if (!endsBlank && (prev.raw === undefined || block.raw === undefined)) out += eol
    }
    out += text
    prev = block
  }
  return out
}
