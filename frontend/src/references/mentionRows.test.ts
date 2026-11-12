// M33, choice 11: an unlinked mention reads as text, and a line that names the note twice is one
// row. The back end sends one occurrence per match, each with the raw line around it; the rows and
// what they show are worked out here.
import { describe, expect, test } from 'vitest'
import type { Occurrence } from '@/api/types'
import { mentionDisplay, mentionRows, rowDisplay } from './mentionRows'

const occ = (start: number, text: string, context: string, contextStart: number): Occurrence => ({
  start,
  end: start + [...text].length,
  text,
  context,
  contextStart,
})

/** The occurrences of `name` the back end would send for `line` starting at `lineStart` in the body. */
function occurrencesIn(line: string, name: string, lineStart = 0): Occurrence[] {
  const out: Occurrence[] = []
  for (let at = line.indexOf(name); at >= 0; at = line.indexOf(name, at + name.length)) {
    out.push(occ(lineStart + [...line.slice(0, at)].length, name, line, lineStart))
  }
  return out
}

/** `text` with each mark in `[…]`, to read a display at a glance. */
function marked({ text, marks }: { text: string; marks: readonly (readonly [number, number])[] }): string {
  let out = ''
  let at = 0
  for (const [s, e] of marks) {
    out += `${text.slice(at, s)}[${text.slice(s, e)}]`
    at = e
  }
  return out + text.slice(at)
}

describe('mentionRows: a line is listed once', () => {
  test('a line that names the note twice is one row holding both occurrences', () => {
    const line = 'Ada met Ada in the mirror.'
    const rows = mentionRows(occurrencesIn(line, 'Ada', 40))
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences.map((o) => o.start)).toEqual([40, 48])
    expect(rows[0].context).toBe(line)
    expect(rows[0].contextStart).toBe(40)
  })

  test('mentions on different lines stay different rows, in the order of the text', () => {
    const rows = mentionRows([...occurrencesIn('and Ada again', 'Ada', 36), ...occurrencesIn('Lunch with Ada.', 'Ada', 7)])
    expect(rows.map((r) => r.context)).toEqual(['Lunch with Ada.', 'and Ada again'])
    expect(rows.map((r) => r.occurrences.length)).toEqual([1, 1])
  })

  test('the same words on two lines are two rows', () => {
    const rows = mentionRows([...occurrencesIn('Ada called', 'Ada', 0), ...occurrencesIn('Ada called', 'Ada', 11)])
    expect(rows).toHaveLength(2)
  })

  test('three on a line, with an emoji before them, are one row', () => {
    const line = '🚀 Ada, Ada and Ada'
    const rows = mentionRows(occurrencesIn(line, 'Ada', 5))
    expect(rows).toHaveLength(1)
    // Offsets count code points, as the back end's do: the rocket is one.
    expect(rows[0].occurrences.map((o) => o.start)).toEqual([7, 12, 20])
    expect(marked(rowDisplay(rows[0]))).toBe('🚀 [Ada], [Ada] and [Ada]')
  })

  test('on a line longer than the window, two windows that overlap are one row showing both', () => {
    // The back end cuts 280 characters around each match: two matches 100 apart share most of it.
    const body = `${'a'.repeat(200)} Ada ${'b'.repeat(96)} Ada ${'c'.repeat(200)}`
    const window = (start: number) => {
      const lo = Math.max(0, start - 138)
      return occ(start, 'Ada', body.slice(lo, lo + 280), lo)
    }
    const rows = mentionRows([window(201), window(302)])
    expect(rows).toHaveLength(1)
    expect(rows[0].contextStart).toBe(63)
    expect(rows[0].context).toBe(body.slice(63, 164 + 280))
    const shown = rowDisplay(rows[0])
    expect(shown.marks.map(([s, e]) => shown.text.slice(s, e))).toEqual(['Ada', 'Ada'])
  })

  test('two windows of one long line that do not touch stay two rows (their text differs)', () => {
    const rows = mentionRows([occ(10, 'Ada', 'x'.repeat(280), 0), occ(900, 'Ada', 'y'.repeat(280), 700)])
    expect(rows).toHaveLength(2)
  })
})

describe('mentionDisplay: the line reads as text', () => {
  const show = (line: string, name = 'Ada') => marked(rowDisplay(mentionRows(occurrencesIn(line, name))[0]))

  test('a link shows its words: the alias when there is one, else its target', () => {
    expect(show('Ada said [[Alpha|the first page]] is done.')).toBe('[Ada] said the first page is done.')
    expect(show('See [[Fix printer]] with Ada.')).toBe('See Fix printer with [Ada].')
    expect(show('[[Alpha#Plan]] and [[Alpha#Plan|the plan]] for Ada')).toBe('Alpha#Plan and the plan for [Ada]')
    expect(show('![[Photo.png]] of Ada')).toBe('Photo.png of [Ada]')
  })

  test('the highlight stays on the name when links before it change length', () => {
    expect(show('[[A very long target name|x]] Ada [[B]] Ada')).toBe('x [Ada] B [Ada]')
  })

  test('list, task, heading and quote markers and emphasis are not shown, as in a backlink row', () => {
    expect(show('- Lunch with **Ada** today')).toBe('Lunch with [Ada] today')
    expect(show('  - [ ] call _Ada_')).toBe('call [Ada]')
    expect(show('## Ada ==notes==')).toBe('[Ada] notes')
    expect(show('> 1. ~~old~~ Ada')).toBe('old [Ada]')
    expect(show('*Ada* and __Ada__')).toBe('[Ada] and [Ada]')
  })

  test('underscores and stars inside words are text', () => {
    expect(show('snake_case_name by Ada, 2*3*4')).toBe('snake_case_name by [Ada], 2*3*4')
  })

  test('a code span is shown as it is written (a link in it is not a link)', () => {
    expect(show('`[[Alpha|x]] **b**` then Ada')).toBe('`[[Alpha|x]] **b**` then [Ada]')
  })

  test('a Markdown link stays as written, as a backlink row shows it', () => {
    expect(show('[site](https://example.org) by Ada')).toBe('[site](https://example.org) by [Ada]')
  })

  test('the end of a CRLF line is not shown', () => {
    expect(rowDisplay(mentionRows(occurrencesIn('Ada called\r', 'Ada'))[0]).text).toBe('Ada called')
  })

  test('a window cut out of a longer line keeps what it starts with (it is not the line\'s start)', () => {
    const cut = `- ${'x'.repeat(274)} Ada`
    expect([...cut].length).toBe(280)
    expect(mentionDisplay(cut, [[277, 280]], false).text.startsWith('- x')).toBe(true)
    expect(mentionDisplay(`- Ada`, [[2, 5]], true)).toEqual({ text: 'Ada', marks: [[0, 3]] })
  })

  test('marks are clamped to the text', () => {
    expect(mentionDisplay('  Ada  ', [[2, 5]], true)).toEqual({ text: 'Ada', marks: [[0, 3]] })
    expect(mentionDisplay('Ada', [[0, 99]], true)).toEqual({ text: 'Ada', marks: [[0, 3]] })
  })
})
