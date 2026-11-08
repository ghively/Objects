import { describe, expect, test } from 'vitest'
import { parseLocalView } from '@/editor/embed/DataViewEmbedView'
import { upgradeKeys } from './keyCompat'

const FILTER_GROUP = { type: 'filterGroup', operator: 'and', elements: [] }

describe('keyCompat', () => {
  test('older keys are renamed at every depth, in order, without touching the input', () => {
    const old = {
      viewDefinition: { dataViewLayout: 'table', calculations: [{ propertyId: 'n', structureId: 'book', kind: 'sum' }] },
      filterGroup: {
        type: 'filterGroup',
        operator: 'and',
        elements: [{ type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['o1'], structureId: 'task' }],
      },
      sorts: [{ propertyId: 'title', option: 'ascending', structureId: 'task' }],
      groupBy: { groups: [{ propertyId: 'status', option: 'default', structureId: 'task' }] },
      structures: [{ id: 'task' }],
      excludeStructureIds: ['tag'],
    }
    const frozen = JSON.stringify(old)
    const up = upgradeKeys(old)
    expect(JSON.stringify(old)).toBe(frozen)
    expect(up).toEqual({
      viewDefinition: { dataViewLayout: 'table', calculations: [{ propertyId: 'n', typeId: 'book', kind: 'sum' }] },
      filterGroup: {
        type: 'filterGroup',
        operator: 'and',
        elements: [{ type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['o1'], typeId: 'task' }],
      },
      sorts: [{ propertyId: 'title', option: 'ascending', typeId: 'task' }],
      groupBy: { groups: [{ propertyId: 'status', option: 'default', typeId: 'task' }] },
      types: [{ id: 'task' }],
      excludeTypeIds: ['tag'],
    })
    expect(Object.keys(up.sorts[0])).toEqual(['propertyId', 'option', 'typeId'])
  })

  test("today's key wins, and a type-id map entry of another shape is kept", () => {
    expect(upgradeKeys({ structureId: 'a', typeId: 'b' })).toEqual({ typeId: 'b' })
    const tableConfigs = { structures: { wrapAllContent: false, properties: [] } }
    expect(upgradeKeys({ tableConfigs })).toEqual({ tableConfigs })
  })

  test("an embed's saved view with older keys reads like one with today's", () => {
    const today = { filterGroup: FILTER_GROUP, sorts: [{ propertyId: 'title', option: 'ascending', typeId: 'task' }], groupBy: null }
    const older = { filterGroup: FILTER_GROUP, sorts: [{ propertyId: 'title', option: 'ascending', structureId: 'task' }], groupBy: null }
    expect(parseLocalView(JSON.stringify(older))).toEqual(parseLocalView(JSON.stringify(today)))
  })
})
