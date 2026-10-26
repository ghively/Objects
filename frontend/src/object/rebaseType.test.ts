import { describe, expect, test } from 'vitest'
import { rebase } from './rebaseType'

describe('rebase', () => {
  test('keeps what the edit did not touch from latest', () => {
    const base = { name: 'A', color: 'gray', options: { a: 1, b: 1 } }
    const latest = { name: 'B', color: 'gray', options: { a: 2, b: 1 } }
    const next = { name: 'A', color: 'blue', options: { a: 1, b: 3 } }
    expect(rebase(base, next, latest)).toEqual({ name: 'B', color: 'blue', options: { a: 2, b: 3 } })
  })

  test('removes keys the edit removed', () => {
    expect(rebase({ a: 1, b: 2 }, { a: 1 }, { a: 5, b: 2 })).toEqual({ a: 5 })
  })

  test('merges id arrays: additions, removals, changes', () => {
    const base = [{ id: 'x', v: 1 }, { id: 'y', v: 1 }]
    const latest = [{ id: 'x', v: 1 }, { id: 'y', v: 2 }, { id: 'a', v: 0 }]
    const next = [{ id: 'x', v: 9 }, { id: 'b', v: 0 }]
    expect(rebase(base, next, latest)).toEqual([{ id: 'x', v: 9 }, { id: 'a', v: 0 }, { id: 'b', v: 0 }])
  })

  test('applies a reorder from the edit', () => {
    const base = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    const next = [{ id: 'z' }, { id: 'x' }, { id: 'y' }]
    const latest = [{ id: 'x' }, { id: 'y' }, { id: 'z' }, { id: 'n' }]
    expect(rebase(base, next, latest).map((i) => i.id)).toEqual(['z', 'x', 'y', 'n'])
  })

  test('two option additions from the same stale copy both survive', () => {
    const base = { set: [{ id: 'a' }] }
    const first = { set: [{ id: 'a' }, { id: 'b' }] }
    const second = { set: [{ id: 'a' }, { id: 'c' }] }
    const afterFirst = rebase(base, first, base)
    expect(rebase(base, second, afterFirst).set.map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })
})
