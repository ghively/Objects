import { describe, expect, test } from 'vitest'
import type { FilterGroup } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'
import { matchingValues } from './matching'

const task = typeDef({
  id: 'task',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    propertyDef({
      id: 'status',
      type: 'label',
      options: { isArray: true, set: [{ id: 'o-done', text: 'Done', color: 'green', icon: null }] },
    }),
    propertyDef({ id: 'done', type: 'boolean' }),
    propertyDef({ id: 'note', type: 'text' }),
    propertyDef({ id: 'points', type: 'number' }),
    propertyDef({ id: 'due', type: 'datetime' }),
  ],
})

const g = (operator: 'and' | 'or', ...elements: FilterGroup['elements']): FilterGroup => ({
  type: 'filterGroup',
  operator,
  elements,
})
const f = (propertyId: string, option: string, referenceValue?: never) => ({
  type: 'filter' as const,
  propertyId,
  option,
  ...(referenceValue !== undefined ? { referenceValue } : {}),
})

describe('matchingValues', () => {
  test('test matchingValues from and-group', () => {
    const group = g('and', f('status', 'contains', ['o-done'] as never), f('done', 'isChecked'))
    expect(matchingValues(group, [task], 'task')).toEqual({ status: ['Done'], done: true })
  })

  test('an or group of two gives nothing; a single-element or counts', () => {
    expect(matchingValues(g('or', f('done', 'isChecked'), f('note', 'is', 'x' as never)), [task], 'task')).toEqual({})
    expect(matchingValues(g('or', f('done', 'isChecked')), [task], 'task')).toEqual({ done: true })
  })

  test('text, number and date filters', () => {
    const group = g(
      'and',
      f('note', 'contains', 'alp' as never),
      f('points', 'equal', 3 as never),
      f('due', 'is', { exactDate: '2026-10-23' } as never),
      f('note', 'endsWith', 'zzz' as never),
    )
    expect(matchingValues(group, [task], 'task')).toEqual({
      note: 'alp',
      points: 3,
      due: { start: '2026-10-23', resolution: 'day' },
    })
  })

  test('other filters, nested groups and filters of another type contribute nothing', () => {
    const group = g(
      'and',
      f('done', 'isNotChecked'),
      g('and', f('done', 'isChecked')),
      { ...f('note', 'is', 'x' as never), typeId: 'page' },
    )
    expect(matchingValues(group, [task], 'task')).toEqual({})
  })

  test('a filter on a synced property gives no value (M29 review #2)', () => {
    const SOURCE = { source: 'Inventory script', staleAfterDays: 7 }
    const host = typeDef({
      id: 'host',
      propertyDefinitions: [
        propertyDef({ id: 'fqdn', type: 'text' }),
        propertyDef({ id: 'diskFree', type: 'number', synced: SOURCE }),
        propertyDef({ id: 'patched', type: 'boolean', synced: SOURCE }),
        propertyDef({ id: 'lastBoot', type: 'datetime', synced: SOURCE }),
      ],
    })
    const group = g(
      'and',
      f('fqdn', 'is', 'app01' as never),
      f('diskFree', 'equal', 40 as never),
      f('patched', 'isChecked'),
      f('lastBoot', 'is', { exactDate: '2026-11-09' } as never),
    )
    expect(matchingValues(group, [host], 'host')).toEqual({ fqdn: 'app01' })
  })
})
