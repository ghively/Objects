// M23 Task 7: On the floor's groups.
import { describe, expect, test } from 'vitest'
import type { FloorItemValue } from '@/api/types'
import { workBoardItem } from '@/test/mockApi'
import { WORK_TEXT } from '../workText'
import { floorGroups, placeOf } from './floor'

const f = (id: string, place: string | null, what: string, collected: string | null = null): FloorItemValue => ({
  id, rev: '0123456789ab', place, what, collected, found: null,
})

describe('floor', () => {
  test('the place drops parenthesised parts and collapses spaces; empty is Anywhere', () => {
    expect(placeOf('Line 3  (by the  door)  printer')).toBe('Line 3 printer')
    expect(placeOf('(somewhere)')).toBe(WORK_TEXT.anywhere)
    expect(placeOf(null)).toBe('Anywhere')
  })

  test('open rows grouped by place, groups by size then name', () => {
    const a = workBoardItem({
      path: 'Tasks/A.md',
      floorItems: [f('a1', 'Line 3', 'Toner box'), f('a2', 'Dock', 'Badge list'), f('a3', 'Line 3 (east)', 'Cable')],
    })
    const gone = workBoardItem({ path: 'Tasks/Gone.md', done: true, stage: 'done', floorItems: [f('g1', 'Dock', 'Old')] })
    const general = [f('n1', 'Cage', 'Spare labels'), f('n2', null, 'Tape')]
    const { open } = floorGroups([a, gone], general)
    expect(open.map((g) => [g.place, g.rows.map((r) => r.what)])).toEqual([
      ['Line 3', ['Toner box', 'Cable']],
      ['Anywhere', ['Tape']],
      ['Cage', ['Spare labels']],
      ['Dock', ['Badge list']],
    ])
    const tape = open[1].rows[0]
    expect(tape.owner).toBeNull()
    expect(tape.key).toBe('general#n2')
    expect(open[0].rows[0].owner?.path).toBe('Tasks/A.md')
    expect(open[0].rows[0].key).toBe('Tasks/A.md#a1')
  })

  test('collected rows newest first, at most 25', () => {
    const items = Array.from({ length: 30 }, (_, k) =>
      f(`c${k}`, 'Dock', `Thing ${k}`, `2026-10-${String(k + 1).padStart(2, '0')}`),
    )
    const { open, collected } = floorGroups([], items)
    expect(open).toEqual([])
    expect(collected).toHaveLength(25)
    expect(collected[0].what).toBe('Thing 29')
    expect(collected[24].what).toBe('Thing 5')
  })
})
