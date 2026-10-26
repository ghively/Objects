import { describe, expect, test } from 'vitest'
import type { DataViewDefinition } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'
import { defaultSmallCard } from '../model'
import { cardProperties, setUseDefault, usesDefaultCard } from './cardConfig'

const NOTE = typeDef({ id: 'note', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' })] })
const OWN = { entityViewType: 'smallCard' as const, properties: [{ propertyType: 'entity_title', propertyId: 'title' }] }
const VIEW_OWN = { entityViewType: 'smallCard' as const, properties: [{ propertyType: 'entity_type', propertyId: 'type' }] }

describe('card config', () => {
  test('test cardProperties prefers view override then type then default', () => {
    const view: DataViewDefinition = { dataViewLayout: 'grid', smallCardViewConfigs: { note: VIEW_OWN } }
    expect(cardProperties({ ...NOTE, smallCardViewConfig: OWN }, view)).toEqual(VIEW_OWN.properties)
    expect(cardProperties({ ...NOTE, smallCardViewConfig: OWN }, { dataViewLayout: 'grid' })).toEqual(OWN.properties)
    expect(cardProperties(NOTE, { dataViewLayout: 'grid' })).toEqual(defaultSmallCard(NOTE).properties)
  })

  test('test Use default off copies type default into view', () => {
    const type = { ...NOTE, smallCardViewConfig: OWN }
    const view: DataViewDefinition = { dataViewLayout: 'grid' }
    expect(usesDefaultCard(type, view)).toBe(true)
    const off = setUseDefault(type, view, false)
    expect(off.smallCardViewConfigs?.note.properties).toEqual(OWN.properties)
    expect(off.smallCardViewConfigs?.note.properties).not.toBe(OWN.properties)
    expect(usesDefaultCard(type, off)).toBe(false)
    expect(setUseDefault(type, off, true).smallCardViewConfigs).toBeUndefined()
  })
})
