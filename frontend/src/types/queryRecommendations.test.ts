import { describe, expect, test } from 'vitest'
import { propertyDef, typeDef } from '@/test/mockApi'
import { queryRecommendations } from './queryRecommendations'

const STATUS = propertyDef({
  id: 'status',
  key: 'status',
  name: 'Status',
  type: 'label',
  options: {
    isArray: false,
    set: [
      { id: 'o1', text: 'Todo', color: 'gray', icon: null },
      { id: 'o2', text: 'Done', color: 'green', icon: null },
    ],
  },
})
const DONE = propertyDef({ id: 'done', key: 'done', name: 'Done', type: 'boolean' })
const TASK = typeDef({ id: 'task', name: 'Task', propertyDefinitions: [STATUS, DONE, propertyDef({ id: 'n', key: 'n', name: 'Note' })] })

describe('queryRecommendations', () => {
  test('test queryRecommendations for a label and a boolean property', () => {
    const r = queryRecommendations(TASK)
    expect(r.map((x) => x.title)).toEqual([
      'Kanban by Status',
      'Filter Status is empty',
      'Task · Status · Todo',
      'Task · Status · Done',
      'Task · Done · Checked',
      'Task · Done · Unchecked',
    ])
    const kanban = r[0]
    expect(kanban.layout).toBe('kanban')
    expect(kanban.definition.types).toEqual([{ id: 'task' }])
    expect(kanban.definition.groupBy?.groups[0]).toMatchObject({ propertyId: 'status', typeId: 'task' })

    const todo = r[2]
    expect(todo.definition.filterGroup.elements).toEqual([
      { type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['o1'], typeId: 'task' },
    ])
    expect(r[1].definition.filterGroup.elements[0]).toMatchObject({ option: 'isEmpty', propertyId: 'status' })
    expect(r[4].definition.filterGroup.elements[0]).toMatchObject({ option: 'isChecked', propertyId: 'done' })
    expect(r[5].definition.filterGroup.elements[0]).toMatchObject({ option: 'isNotChecked' })
  })

  test('test the built-in Page type is named Note in its suggestions; the definition still points at the type (M32)', () => {
    const page = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, propertyDefinitions: [DONE] })
    const r = queryRecommendations(page)
    expect(r.map((x) => x.title)).toEqual(['Note · Done · Checked', 'Note · Done · Unchecked'])
    expect(r[0].definition.types).toEqual([{ id: 'page' }])
  })

  test('a type with no label or boolean property has none', () => {
    expect(queryRecommendations(typeDef({ id: 'plain' }))).toEqual([])
  })
})
