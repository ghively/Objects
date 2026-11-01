// M9 Task 19: the CSV reader for Import CSV (RFC 4180; the inverse of `toCsv`).
import { describe, expect, test } from 'vitest'
import { toCsv } from '@/editor/table/csv'
import { parseCsv, parseCsvCells } from './csvParse'

describe('parseCsv', () => {
  test('test parse quotes newlines bom', () => {
    const text = '﻿Name,Note\r\n"Smith, Jane","She said ""hi""\nthen left"\r\nBob,\r\n'
    expect(parseCsv(text)).toEqual({
      rows: [
        ['Name', 'Note'],
        ['Smith, Jane', 'She said "hi"\nthen left'],
        ['Bob', ''],
      ],
      error: false,
    })
  })

  test('LF and lone CR records, and no trailing line break', () => {
    expect(parseCsv('a,b\nc,d\re,f').rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ])
  })

  test('round trips toCsv', () => {
    const grid = [
      ['x', 'a,b', 'say "q"'],
      ['line\r\nbreak', '', 'z'],
    ]
    expect(parseCsv(toCsv(grid))).toEqual({ rows: grid, error: false })
  })

  test('an empty file has no records', () => {
    expect(parseCsv('')).toEqual({ rows: [], error: false })
    expect(parseCsv('﻿')).toEqual({ rows: [], error: false })
  })

  test('an unterminated quote or a stray quote is flagged', () => {
    expect(parseCsv('a,"open\nb').error).toBe(true)
    expect(parseCsv('a,b"c').error).toBe(true)
    expect(parseCsv('a,b"c').rows).toEqual([['a', 'b"c']])
  })

  test('text after a closing quote is kept but flagged (audit 2026-11-01)', () => {
    expect(parseCsv('"a"x,b')).toEqual({ rows: [['ax', 'b']], error: true })
    expect(parseCsv('"a" ,b').error).toBe(true)
    expect(parseCsv('"a",b\n"c"\n').error).toBe(false)
  })

  test('parseCsvCells tells a quoted cell from an unquoted one', () => {
    expect(parseCsvCells('"Smith, John",x,""\n')).toEqual({
      rows: [
        [
          { text: 'Smith, John', quoted: true },
          { text: 'x', quoted: false },
          { text: '', quoted: true },
        ],
      ],
      error: false,
    })
  })
})
