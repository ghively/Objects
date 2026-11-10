// M29 Task 10: the palette's one create row is of the suggested type when no type filter is set.
import { describe, expect, test } from 'vitest'
import { typeDef } from '@/test/mockApi'
import { buildSearchOptions, NO_FILTERS, suggestableTypes } from './searchOptions'

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const HOST = typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts' })
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People' })
const types = [PAGE, HOST, PERSON]

describe('buildSearchOptions with a suggested type', () => {
  test('the create row is of the suggested type', () => {
    expect(buildSearchOptions('SRV-02', types, [], NO_FILTERS, 'host')[0]).toEqual({
      kind: 'create',
      typeId: 'host',
      title: 'SRV-02',
      label: 'Create new Host with title "SRV-02"',
    })
  })

  test('a type filter beats the suggestion', () => {
    const filters = { ...NO_FILTERS, types: ['person'] }
    expect(buildSearchOptions('SRV-02', types, [], filters, 'host')[0]).toMatchObject({ kind: 'create', typeId: 'person' })
  })

  test('suggested null gives Page', () => {
    expect(buildSearchOptions('SRV-02', types, [], NO_FILTERS, null)[0]).toMatchObject({ kind: 'create', typeId: 'page' })
    expect(buildSearchOptions('SRV-02', types, [], NO_FILTERS)[0]).toMatchObject({ kind: 'create', typeId: 'page' })
    expect(buildSearchOptions('SRV-02', types, [], NO_FILTERS, 'gone')[0]).toMatchObject({ kind: 'create', typeId: 'page' })
  })

  test('suggestable types leave out read-only, DailyNote and Whiteboard', () => {
    const daily = typeDef({ id: 'dailynote', name: 'DailyNote', basic: true })
    const board = typeDef({ id: 'whiteboard', name: 'Whiteboard', basic: true })
    const locked = typeDef({ id: 'locked', name: 'Locked', readOnlyReason: 'bad JSON' })
    expect(suggestableTypes([PAGE, daily, board, locked, HOST]).map((t) => t.id)).toEqual(['page', 'host'])
  })
})
