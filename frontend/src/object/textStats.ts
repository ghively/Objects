/**
 * Text stats (M9), as Object's `calculateTextStats` counts them on a page's plain text with
 * math left out:
 * - words: `Intl.Segmenter` word segments that are word-like; hyphen-joined words count once
 * - sentences: sentence segments
 * - paragraphs: the lines of the plain text (`split(/\n/)`), 0 when it is empty
 * - characters: graphemes, whitespace included
 * The page inspector's "Stats" tab and the `…` menu's "Text Stats" show the same rows: words,
 * sentences, paragraphs, characters, then "Created at" (not for daily notes) and "Last updated".
 * Object's page is Markdown, so `plainText` first strips the Markdown syntax: one line per
 * non-empty block line (our reading of Object's one-line-per-block plain text).
 */
import type { ObjectSummary } from '@/api/types'
import { formatDate } from '@/properties/format'

export interface TextStats {
  words: number
  sentences: number
  paragraphs: number
  characters: number
}

/** Reference strings: `textStats.*` (plural pairs), `propertyTypes.entity_*.name`, `xRay.textStats.header`. */
export const TEXT_STATS_TEXT = {
  word: ['word', 'words'],
  sentence: ['sentence', 'sentences'],
  paragraph: ['paragraph', 'paragraphs'],
  character: ['character', 'characters'],
  /** `propertyTypes.entity_createdAt.name` */
  createdAt: 'Created at',
  /** `propertyTypes.entity_lastUpdated.name` */
  lastUpdated: 'Last updated',
  /** `xRay.textStats.header` */
  header: 'Text stats',
} as const

/** `$$ … $$` math blocks (a line of `$$` opens and closes them). */
const MATH_BLOCK = /^[ \t]*\$\$[\s\S]*?\$\$[ \t]*$/gm
/** Inline `$…$` math with Pandoc's dollar rules (no space inside the dollars, no digit after). */
const MATH_INLINE = /(?<!\\)\$(?=\S)(?:\\.|[^$\\\n])+?(?<=\S)\$(?!\d)/g

/** A page's Markdown body as plain text: no syntax, no math, one line per non-empty line. */
export function plainText(markdown: string): string {
  let s = markdown.replace(/\r\n?/g, '\n')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(MATH_BLOCK, '')
  s = s.replace(/^[ \t]*(```|~~~).*$/gm, '')
  const lines: string[] = []
  for (const raw of s.split('\n')) {
    let line = raw
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue // thematic break
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue // table rule
    line = line
      .replace(MATH_INLINE, '')
      .replace(/!\[\[[^\]]*\]\]/g, '') // embeds
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<\/?[A-Za-z][^>]*>/g, '')
      .replace(/^\s*>+\s?/, '') // quotes and callouts
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '')
      .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?=[^\w*]|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\|/g, ' ')
      .replace(/\\([\\`*_{}[\]()#+\-.!|$>~=])/g, '$1')
    if (line.trim()) lines.push(line.trim())
  }
  return lines.join('\n')
}

function segmenter(locale: string | undefined, granularity: 'word' | 'sentence' | 'grapheme'): Intl.Segmenter | null {
  try {
    return new Intl.Segmenter(locale, { granularity })
  } catch {
    return null
  }
}

function countWords(text: string, locale?: string): number {
  const seg = segmenter(locale, 'word')
  if (!seg) return text.split(/\s+/).filter(Boolean).length
  let count = 0
  // A word right after "word-" continues the hyphenated word.
  let prev: 'word' | 'hyphen-after-word' | 'other' = 'other'
  for (const s of seg.segment(text)) {
    if (s.isWordLike) {
      if (prev !== 'hyphen-after-word') count++
      prev = 'word'
    } else {
      prev = prev === 'word' && /^[-‐‑]$/.test(s.segment) ? 'hyphen-after-word' : 'other'
    }
  }
  return count
}

function countSegments(text: string, granularity: 'sentence' | 'grapheme', locale?: string): number {
  const seg = segmenter(locale, granularity)
  if (!seg) return granularity === 'grapheme' ? [...text].length : text.split(/[.!?]+\s+/).filter(Boolean).length
  let count = 0
  for (const s of seg.segment(text)) if (granularity === 'grapheme' || s.segment.trim()) count++
  return count
}

/** The counts of a plain text (see `plainText`). */
export function textStats(text: string, locale?: string): TextStats {
  return {
    words: countWords(text, locale),
    sentences: countSegments(text, 'sentence', locale),
    paragraphs: text === '' ? 0 : text.split(/\n/).length,
    characters: countSegments(text, 'grapheme', locale),
  }
}

export type StatKey = keyof TextStats | 'createdAt' | 'lastUpdated'

/** A stats row: a count (`value` then the pluralized noun) or a date (`label` then `value`). */
export interface StatRow {
  key: StatKey
  kind: 'count' | 'date'
  label: string
  value: string
}

function plural(n: number, forms: readonly [string, string]): string {
  return n === 1 ? forms[0] : forms[1]
}

function stamp(v: string | null): string {
  if (!v) return '—'
  return formatDate({ start: v, resolution: /T/.test(v) ? 'time' : 'day' }) || '—'
}

/** The rows in Object's order; "Created at" is hidden for daily notes. */
export function statRows(stats: TextStats, summary: ObjectSummary, opts: { dailyNote: boolean }): StatRow[] {
  const count = (key: keyof TextStats, forms: readonly [string, string]): StatRow => ({
    key,
    kind: 'count',
    label: plural(stats[key], forms),
    value: stats[key].toLocaleString(),
  })
  const rows: StatRow[] = [
    count('words', TEXT_STATS_TEXT.word),
    count('sentences', TEXT_STATS_TEXT.sentence),
    count('paragraphs', TEXT_STATS_TEXT.paragraph),
    count('characters', TEXT_STATS_TEXT.character),
  ]
  if (!opts.dailyNote) {
    rows.push({ key: 'createdAt', kind: 'date', label: TEXT_STATS_TEXT.createdAt, value: stamp(summary.createdAt) })
  }
  rows.push({ key: 'lastUpdated', kind: 'date', label: TEXT_STATS_TEXT.lastUpdated, value: stamp(summary.lastUpdated) })
  return rows
}
