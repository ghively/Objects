// M29 Task 8: the TypeScript port of the type suggestion runs the same parity fixture as the
// Python reference (`backend/tests/test_m29_typesuggest.py`), and a glob never backtracks.
import { describe, expect, test } from 'vitest'
import type { TypeDef } from '@/api/types'
import { typeDef } from '@/test/mockApi'
import fixture from './__fixtures__/suggest-cases.json'
import { compilePattern, matches, NAME_MAX, suggestType, SUGGEST_TEXT } from './typeSuggest'

interface Fixture {
  types: { id: string; namePatterns: unknown[] }[]
  cases: { name: string; ctx: { allowed?: string[]; scope?: string[]; last?: string | null }; expect: string[] }[]
  patterns: { pattern: unknown; valid: boolean; matches: string[]; misses: string[] }[]
}

const data = fixture as Fixture
const types: TypeDef[] = data.types.map((t) => typeDef({ id: t.id, namePatterns: t.namePatterns as string[] }))

describe('type suggestion (TS port)', () => {
  test('parity cases', () => {
    for (const c of data.cases) {
      expect({ name: c.name, ctx: c.ctx, got: suggestType(c.name, { types, ...c.ctx }) }).toEqual({
        name: c.name,
        ctx: c.ctx,
        got: c.expect,
      })
    }
    for (const p of data.patterns) {
      const compiled = compilePattern(p.pattern as string)
      expect({ pattern: p.pattern, valid: compiled !== null }).toEqual({ pattern: p.pattern, valid: p.valid })
      for (const name of p.matches) {
        expect({ pattern: p.pattern, name, hit: matches(name, [p.pattern]) }).toEqual({ pattern: p.pattern, name, hit: true })
      }
      for (const name of p.misses) {
        expect({ pattern: p.pattern, name, hit: matches(name, [p.pattern]) }).toEqual({ pattern: p.pattern, name, hit: false })
      }
    }
  })

  test('a pathological name returns quickly', () => {
    const name = 'a'.repeat(5000) + '!'
    const start = performance.now()
    expect(matches(name, ['*@*@*@*@*@*#'])).toBe(false)
    expect(performance.now() - start).toBeLessThan(50)
    // The whole tokens stay linear too.
    const t2 = performance.now()
    expect(matches('a' + ' '.repeat(5000) + 'x', ['{version}', '{ip}', '{cidr}', '{fqdn}'])).toBe(false)
    expect(matches(':'.repeat(5000) + 'g', ['{ip}', '{cidr}'])).toBe(false)
    expect(performance.now() - t2).toBeLessThan(50)
  })

  test("follows the Python reference's edge rules", () => {
    expect(compilePattern('SRV-*')?.source).toBe('SRV-*')
    expect(compilePattern('{IP}')).toBeNull() // tokens are case-sensitive
    expect(compilePattern('constructor')?.test('Constructor')).toBe(true) // a plain glob
    expect(compilePattern('x'.repeat(99) + '😀')).not.toBeNull() // code points, not UTF-16 units
    expect(matches('😀1', ['?#'])).toBe(true)
    expect(matches('SQL\nServer 2019', ['{version}'])).toBe(true)
    expect(matches(' APP01　', ['@@@##'])).toBe(true) // trim() whitespace
    expect(matches('ÄB12', ['@@##'])).toBe(false) // @ is ASCII a-z
    expect(matches('٣٤', ['##'])).toBe(false) // # is ASCII 0-9
    const host = typeDef({ id: 'host', namePatterns: ['@@@##'] })
    expect(suggestType('APP01', { types: [host], allowed: ['host', 'host'] })).toEqual(['host'])
  })

  test('a name over NAME_MAX (300) code points matches no pattern, counted before the trim (M29 review #13)', () => {
    expect(NAME_MAX).toBe(300)
    expect(matches('a'.repeat(300), ['*'])).toBe(true)
    expect(matches('a'.repeat(301), ['*'])).toBe(false)
    // Code points, not UTF-16 units: 300 emoji are 600 units but still match.
    expect(matches('😀'.repeat(300), ['*'])).toBe(true)
    // Counted before the trim: 299 letters and two spaces are 301.
    expect(matches(' ' + 'a'.repeat(299) + ' ', ['*'])).toBe(false)
    const host = typeDef({ id: 'host', namePatterns: ['*'] })
    expect(suggestType('a'.repeat(301), { types: [host] })).toEqual([])
  })

  test('ignores non-string patterns', () => {
    expect(matches('APP01', ['{foo}', 5, null, undefined, {}, '@@@##'])).toBe(true)
    expect(matches('APP01', [5, null])).toBe(false)
    expect(matches('APP01', 'APP01' as unknown as unknown[])).toBe(false)
    expect(compilePattern(5 as unknown as string)).toBeNull()
    const garbled = typeDef({ id: 'odd', namePatterns: 'APP01' as unknown as string[] })
    expect(suggestType('APP01', { types: [garbled] })).toEqual([])
    expect(SUGGEST_TEXT.suggested).toBe('Suggested')
  })
})
