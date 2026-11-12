/**
 * M33, choice 11: the rows of the Mentions tab. The back end sends one occurrence per match of
 * the note's name (`MentionEntry.occurrences`), each with the raw line around it (an exact slice
 * of the body, at most 280 characters) and where that slice starts. Here they become rows:
 *
 * - **A line is listed once** (`mentionRows`): occurrences whose slices are the same stretch of
 *   the body, or touch, are one row, with every match highlighted and one "Link" that links them
 *   all. A line of up to 280 characters is always one slice, so it is always one row; on a longer
 *   line two matches share a row when their windows overlap (the row shows both windows joined).
 * - **The line reads as text** (`mentionDisplay`), the way a backlink row does (the back end's
 *   `_backlink_context`): a `[[link]]` shows its words (the alias when there is one), the line's
 *   block markers (quote, heading, list item, task box) and emphasis marks are not shown, and
 *   the white space at its ends is dropped. Other Markdown stays as written, as in a backlink
 *   row; a code span is shown exactly as written. Display only: the offsets sent to "Link" are
 *   the back end's own.
 *
 * Offsets from the back end count code points (`lib/codepoints.ts`); `mentionDisplay` works in
 * the string's own (UTF-16) offsets.
 */
import type { Occurrence } from '@/api/types'
import { cpToUtf16 } from '@/lib/codepoints'

/** The back end's `CONTEXT_MAX`: a slice this long was cut out of a longer line. */
const CONTEXT_MAX = 280

export interface MentionRow {
  /** The matches in this row, in the order of the text. */
  occurrences: Occurrence[]
  /** The stretch of the body the row shows, as written. */
  context: string
  /** Where `context` starts in the body (code points). */
  contextStart: number
}

const codePoints = (s: string) => Array.from(s)

/** One row per line (or per stretch of a long line), in the order of the text. */
export function mentionRows(occurrences: readonly Occurrence[]): MentionRow[] {
  const rows: (MentionRow & { length: number })[] = []
  for (const occ of [...occurrences].sort((a, b) => a.start - b.start)) {
    const last = rows[rows.length - 1]
    const chars = codePoints(occ.context)
    if (last && occ.contextStart <= last.contextStart + last.length) {
      last.occurrences.push(occ)
      // A window that reaches further than the row does adds what it has beyond the row's end.
      const beyond = chars.slice(last.contextStart + last.length - occ.contextStart)
      last.context += beyond.join('')
      last.length += beyond.length
    } else {
      rows.push({ occurrences: [occ], context: occ.context, contextStart: occ.contextStart, length: chars.length })
    }
  }
  return rows.map(({ occurrences: o, context, contextStart }) => ({ occurrences: o, context, contextStart }))
}

export interface MentionDisplay {
  /** What the row shows. */
  text: string
  /** The matches in `text`, as `[start, end)` offsets of the string. */
  marks: [number, number][]
}

/** A line's block markers (the back end's `_PREFIX_RE`): quote, heading, list item, task box. */
const PREFIX = /^[ \t]*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/

/**
 * What is not shown as written, in one pass: a code span (kept as it is, so nothing in it is
 * read), a wikilink or embed (group 2 its target, group 3 its `#heading` and `|alias`; the back
 * end's `_LINK_RE`), and an emphasis mark (the back end's `_EMPHASIS_RE`: bold, strike,
 * highlight, and a single `*` or `_` at a word's edge).
 */
const TOKEN = new RegExp(
  [
    '(``[^\\n]+?``|`[^`\\n]+`)',
    '!?\\[\\[([^\\[\\]|#\\n]+)((?:#[^\\[\\]|\\n]*)?(?:\\|[^\\[\\]\\n]*)?)\\]\\]',
    '\\*\\*|__|~~|==|(?<!\\S)\\*(?=\\S)|(?<=\\S)\\*(?!\\S)|(?<![\\p{L}\\p{N}_])_(?=\\S)|(?<=\\S)_(?![\\p{L}\\p{N}_])',
  ].join('|'),
  'gu',
)

/**
 * `context` as a row shows it, with `spans` (the matches, as `[start, end)` offsets of
 * `context`) carried over to the shown text. `wholeLine`: `context` starts where its line does,
 * so the line's block markers can be told from text.
 */
export function mentionDisplay(context: string, spans: readonly (readonly [number, number])[], wholeLine: boolean): MentionDisplay {
  // at[i]: where the character at `i` of `context` (or what replaced it) starts in `out`.
  const at = new Array<number>(context.length + 1)
  let out = ''
  let pos = 0
  const keep = (to: number) => {
    for (; pos < to; pos++) {
      at[pos] = out.length
      out += context[pos]
    }
  }
  const replace = (to: number, by: string) => {
    for (; pos < to; pos++) at[pos] = out.length
    out += by
  }
  if (wholeLine) replace(PREFIX.exec(context)?.[0].length ?? 0, '')
  TOKEN.lastIndex = pos
  for (let m = TOKEN.exec(context); m; m = TOKEN.exec(context)) {
    keep(m.index)
    const end = m.index + m[0].length
    if (m[1] !== undefined) keep(end)
    else if (m[2] !== undefined) replace(end, m[3].includes('|') ? m[3].slice(m[3].indexOf('|') + 1) : m[2] + m[3])
    else replace(end, '')
  }
  keep(context.length)
  at[context.length] = out.length
  const lead = out.length - out.trimStart().length
  const text = out.trim()
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n - lead))
  const place = (i: number) => clamp(at[Math.max(0, Math.min(context.length, i))])
  return { text, marks: spans.map(([s, e]) => [place(s), Math.max(place(s), place(e))]) }
}

/** A row as it is shown: its text, and every match in it. */
export function rowDisplay(row: MentionRow): MentionDisplay {
  const spans = row.occurrences.map(
    (o) => [cpToUtf16(row.context, o.start - row.contextStart), cpToUtf16(row.context, o.end - row.contextStart)] as const,
  )
  return mentionDisplay(row.context, spans, codePoints(row.context).length < CONTEXT_MAX)
}
