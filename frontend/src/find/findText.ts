/** Pure text matching for Find in page. */

export interface FindOptions {
  /** "Match case": compare letters exactly. Off folds case (Unicode simple case folding). */
  matchCase: boolean
  /** "Match whole word": a match may not touch a letter, digit or underscore on either side. */
  wholeWord: boolean
}

export interface TextMatch {
  /** Offset of the first matched character (UTF-16 code units). */
  from: number
  /** Offset just past the last matched character. */
  to: number
}

export const NO_FIND_OPTIONS: FindOptions = { matchCase: false, wholeWord: false }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Characters that make up a word (Unicode letters, marks, digits, connector punctuation). */
const WORD = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]'

/** The regular expression for `query`, or null for an empty query. */
export function findRegExp(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null
  let source = escapeRegExp(query)
  if (opts.wholeWord) source = `(?<!${WORD})${source}(?!${WORD})`
  return new RegExp(source, opts.matchCase ? 'gu' : 'giu')
}

/**
 * Every match of `query` in `text`, left to right and non-overlapping (like a browser's find:
 * "aa" in "aaa" matches once, at 0). An empty query matches nothing.
 */
export function findMatches(text: string, query: string, opts: FindOptions = NO_FIND_OPTIONS): TextMatch[] {
  const re = findRegExp(query, opts)
  if (!re) return []
  const out: TextMatch[] = []
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue
    out.push({ from: m.index, to: m.index + m[0].length })
  }
  return out
}
