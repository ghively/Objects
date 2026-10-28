import { describe, expect, test } from 'vitest'
import { findMatches } from './findText'

const off = { matchCase: false, wholeWord: false }

describe('findMatches', () => {
  test('findMatches case and whole word', () => {
    const text = 'Café cafe CAFÉ café-bar decafé'
    // Case folds by default; accents are significant (é is not e).
    expect(findMatches(text, 'café', off)).toEqual([
      { from: 0, to: 4 },
      { from: 10, to: 14 },
      { from: 15, to: 19 },
      { from: 26, to: 30 },
    ])
    expect(findMatches(text, 'café', { matchCase: true, wholeWord: false })).toEqual([
      { from: 15, to: 19 },
      { from: 26, to: 30 },
    ])
    // Whole word: "-" is a boundary, a letter is not (Unicode letters count as word characters).
    expect(findMatches(text, 'café', { matchCase: false, wholeWord: true })).toEqual([
      { from: 0, to: 4 },
      { from: 10, to: 14 },
      { from: 15, to: 19 },
    ])
    expect(findMatches('naïve naïveté ünïcode', 'naïve', { matchCase: false, wholeWord: true })).toEqual([
      { from: 0, to: 5 },
    ])
    expect(findMatches('über Über', 'ÜBER', off)).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 },
    ])
    expect(findMatches('a_b ab', 'a', { matchCase: false, wholeWord: true })).toEqual([])
  })

  test('overlapping candidates match left to right without overlap', () => {
    expect(findMatches('aaaa', 'aa', off)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
    expect(findMatches('aaa', 'aa', off)).toEqual([{ from: 0, to: 2 }])
    expect(findMatches('aa aaa', 'aa', { matchCase: false, wholeWord: true })).toEqual([{ from: 0, to: 2 }])
  })

  test('empty query matches nothing; regex characters are literal', () => {
    expect(findMatches('anything', '', off)).toEqual([])
    expect(findMatches('a.b axb (c) [d] $e^ a/b \\', '.', off)).toEqual([{ from: 1, to: 2 }])
    expect(findMatches('(c) [d] $e^ a/b \\ x-y', '(c)', off)).toEqual([{ from: 0, to: 3 }])
    expect(findMatches('[d] x-y a/b', 'x-y', off)).toEqual([{ from: 4, to: 7 }])
    expect(findMatches('a/b \\', '\\', off)).toEqual([{ from: 4, to: 5 }])
    expect(findMatches('$e^', '$e^', off)).toEqual([{ from: 0, to: 3 }])
  })
})
