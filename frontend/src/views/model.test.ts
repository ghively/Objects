import { describe, expect, test } from 'vitest'
import { propertyDef, typeDef } from '@/test/mockApi'
import {
  ALL_NOTES_LAYOUTS,
  CARD_GAP,
  CARD_WIDTH,
  FULL_VIEW_LAYOUTS,
  LAYOUTS,
  STANDARD_LAYOUTS,
  columnCount,
  defaultSmallCard,
  defaultViewState,
} from './model'

describe('view model', () => {
  test('LAYOUTS labels and icons', () => {
    expect(LAYOUTS.grid.label).toBe('Gallery')
    expect(LAYOUTS.grid.icon).toBe('ph-grid-four')
    expect(LAYOUTS.wall.icon).toBe('ph-wall')
    expect(LAYOUTS.table.icon).toBe('ph-table')
    expect(LAYOUTS.list.icon).toBe('ph-list-dashes')
    expect(LAYOUTS.kanban.icon).toBe('ph-kanban')
    expect(LAYOUTS.embed.icon).toBe('ph-text-indent')
    expect(LAYOUTS.gallery.label).toBe('Gallery strip')
    for (const list of [STANDARD_LAYOUTS, FULL_VIEW_LAYOUTS, ALL_NOTES_LAYOUTS]) {
      expect(list).not.toContain('gallery')
    }
    // The behaviour catalog's order, then Object's own layouts.
    expect(FULL_VIEW_LAYOUTS).toEqual(['list', 'wall', 'kanban', 'grid', 'table', 'embed', 'calendar', 'timeline', 'chart'])
    expect(STANDARD_LAYOUTS).toEqual(['list', 'wall', 'grid', 'table', 'embed'])
    expect(ALL_NOTES_LAYOUTS).toEqual(['list', 'wall', 'grid', 'embed'])
  })

  test('columnCount', () => {
    expect(columnCount(0)).toBe(1)
    expect(columnCount(216)).toBe(1)
    expect(columnCount(236)).toBe(1)
    expect(columnCount(472)).toBe(2)
    expect(columnCount(1000)).toBe(4)
    expect(columnCount(3000)).toBe(10)
    expect(columnCount(360, 168)).toBe(2)
    expect(CARD_WIDTH).toEqual({ phone: 168, desktop: 208 })
    expect(CARD_GAP).toBe(12)
  })

  test('defaultSmallCard common and daily note', () => {
    const page = typeDef({ id: 'page' })
    expect(defaultSmallCard(page).properties.map((p) => p.propertyId)).toEqual(['type', 'title', 'tags', 'computed_preview'])

    const props = ['a', 'b', 'c', 'd', 'e'].map((k) => propertyDef({ id: k, key: k }))
    const sys = propertyDef({ id: 'tags', key: 'tags', type: 'entity_tags' })
    const daily = typeDef({ id: 'dailynote', propertyDefinitions: [sys, ...props] })
    expect(defaultSmallCard(daily).properties.map((p) => p.propertyId)).toEqual(['type', 'title', 'a', 'b', 'c', 'd'])
  })

  test('defaultViewState lists, grids for media types', () => {
    expect(defaultViewState().viewDefinition.dataViewLayout).toBe('list')
    expect(defaultViewState(typeDef({ id: 'image' })).viewDefinition.dataViewLayout).toBe('grid')
    expect(defaultViewState().filterGroup).toEqual({ type: 'filterGroup', operator: 'and', elements: [] })
  })
})
