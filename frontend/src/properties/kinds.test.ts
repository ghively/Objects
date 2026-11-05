import { describe, expect, it } from 'vitest'
import { PROPERTY_TYPES } from '@/api/types'
import { typeDef } from '@/test/mockApi'
import { ADD_PROPERTY_ITEMS, KIND_META, objectSelectTypes } from './kinds'

describe('KIND_META', () => {
  it('test every kind has a name, description and icon', () => {
    for (const t of PROPERTY_TYPES) {
      expect(KIND_META[t].name, t).toBeTruthy()
      expect(typeof KIND_META[t].description, t).toBe('string')
      expect(KIND_META[t].icon, t).toMatch(/^ph-/)
    }
  })

  it('test labels and icons are the expected ones', () => {
    expect(KIND_META.datetime.name).toBe('Date time')
    expect(KIND_META.datetimeSimple.name).toBe('Date time')
    expect(KIND_META.boolean).toEqual({ name: 'Checkbox', description: 'True or false value', icon: 'ph-check-square' })
    expect(KIND_META.blocks.name).toBe('Content')
    expect(KIND_META.entity_type.name).toBe('Object type')
    expect(KIND_META.label.icon).toBe('ph-caret-circle-down')
    expect(KIND_META.entity_collections.icon).toBe('ph-cards-three')
  })
})

describe('ADD_PROPERTY_ITEMS', () => {
  it('test ADD_PROPERTY_ITEMS order has 15 catalogued entries then the six M12 kinds and Object Select lists Page, Tag and custom types but not Task', () => {
    expect(ADD_PROPERTY_ITEMS.map((i) => i.name)).toEqual([
      'Text',
      'Content',
      'Tags',
      'Label',
      'Object Select',
      'Checkbox',
      'Date time',
      'Number',
      'Title',
      'Description',
      'Cover Image',
      'Icon',
      'Created at',
      'Last updated',
      'Aliases',
      'Formula',
      'Rollup',
      'ID',
      'Email',
      'Phone',
      'Files',
    ])
    expect(ADD_PROPERTY_ITEMS.map((i) => i.type)).toEqual([
      'textBlock',
      'blocks',
      'entity_tags',
      'label',
      'entity',
      'boolean',
      'datetime',
      'number',
      'entity_title',
      'entity_description',
      'coverImage',
      'entity_icon',
      'entity_createdAt',
      'entity_lastUpdated',
      'entity_aliases',
      'formula',
      'rollup',
      'uniqueId',
      'email',
      'phone',
      'files',
    ])
    const objectSelect = ADD_PROPERTY_ITEMS.find((i) => i.action === 'objectSelect')
    expect(objectSelect?.description).toBe('Link to objects of a specific type.')
    const cover = ADD_PROPERTY_ITEMS.find((i) => i.action === 'coverImage')
    expect(cover?.description).toBe('A single select image property.')
    // Kinds never offered here.
    for (const t of ['text', 'url', 'simpleTableBlock', 'datetimeSimple'] as const) {
      expect(ADD_PROPERTY_ITEMS.some((i) => i.type === t)).toBe(false)
    }

    const types = [
      typeDef({ id: 'page', name: 'Page', basic: true }),
      typeDef({ id: 'tag', name: 'Tag', basic: true }),
      typeDef({ id: 'task', name: 'Task', basic: true }),
      typeDef({ id: 'dailynote', name: 'DailyNote', basic: true }),
      typeDef({ id: 'weblink', name: 'Weblink', basic: true }),
      typeDef({ id: 'project', name: 'Project' }),
    ]
    expect(objectSelectTypes(types).map((t) => t.id)).toEqual(['page', 'tag', 'weblink', 'project'])
  })
})
