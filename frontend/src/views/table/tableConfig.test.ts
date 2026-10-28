import { describe, expect, test } from 'vitest'
import type { TableViewConfig } from '@/api/types'
import { cellFor } from '@/properties/cellFor'
import { BacklinksCell } from '@/properties/cells/SystemFieldCell'
import { propertyDef, typeDef } from '@/test/mockApi'
import { propertyChoices } from '../properties'
import {
  clampWidth,
  DEFAULT_COL_WIDTH,
  isWrapped,
  moveColumn,
  normalizeTableConfig,
  setAllHidden,
  setColWidth,
  setHidden,
  tableDefs,
  setPinnedThrough,
  setWrap,
  setWrapAll,
  visibleColumns,
} from './tableConfig'

const T = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    propertyDef({ id: 'note', type: 'text' }),
    propertyDef({ id: 'qty', type: 'number' }),
    propertyDef({ id: 'wide', type: 'number', tableColWidth: 20 }),
  ],
})

const col = (id: string, type: string, extra: Partial<TableViewConfig['properties'][number]> = {}) => ({
  id,
  type,
  isHidden: false,
  wrapContent: false,
  colWidth: 12,
  ...extra,
})

describe('normalizeTableConfig', () => {
  test('normalize appends new and prunes deleted columns, title unhideable', () => {
    const cfg = normalizeTableConfig(T, {
      wrapAllContent: false,
      properties: [col('qty', 'number'), col('gone', 'text'), col('title', 'entity_title', { isHidden: true })],
    })
    expect(cfg.properties.map((c) => c.id)).toEqual(['title', 'qty', 'note', 'wide'])
    expect(cfg.properties[0].isHidden).toBe(false)
    expect(cfg.wrapAllContent).toBe(false)
  })

  test('wrapAllContent defaults to true', () => {
    expect(normalizeTableConfig(T).wrapAllContent).toBe(true)
  })

  test('width clamped and default widths per kind', () => {
    const cfg = normalizeTableConfig(T, {
      wrapAllContent: true,
      properties: [
        col('title', 'entity_title', { colWidth: undefined as unknown as number }),
        col('note', 'text', { colWidth: 1 }),
        col('qty', 'number', { colWidth: 80 }),
      ],
    })
    const w = Object.fromEntries(cfg.properties.map((c) => [c.id, c.colWidth]))
    expect(w.title).toBe(DEFAULT_COL_WIDTH.entity_title)
    expect(w.note).toBe(2)
    expect(w.qty).toBe(50)
    // `tableColWidth` overrides the kind default; a column with no width is never 50.
    expect(w.wide).toBe(20)
    expect(clampWidth(1)).toBe(2)
    expect(clampWidth(80)).toBe(50)
  })

  test('non-numeric width takes the default', () => {
    const cfg = normalizeTableConfig(T, { wrapAllContent: true, properties: [col('note', 'text', { colWidth: 'x' as unknown as number })] })
    expect(cfg.properties.find((c) => c.id === 'note')?.colWidth).toBe(13)
  })

  test('test table and cards offer the backlinks field read-only', () => {
    const t = typeDef({
      id: 'p',
      propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), propertyDef({ id: 'bl', type: 'entity_backlinks' })],
    })
    // M5: the backlinks are a column (read-only: its cell never writes; see cells.test.tsx).
    expect(normalizeTableConfig(t).properties.map((c) => c.id)).toEqual(['title', 'bl'])
    expect(tableDefs(t).map((d) => d.key)).toEqual(['title', 'bl'])
    expect(cellFor('entity_backlinks')).toBe(BacklinksCell)
    // Filters, sorts and grouping see it too.
    expect(propertyChoices([t]).find((c) => c.key === 'bl')?.kind).toBe('entity_backlinks')
  })
})

describe('edits', () => {
  const base = () => normalizeTableConfig(T)

  test('hide keeps title and fixes the pin', () => {
    let c = setPinnedThrough(base(), 'wide')
    expect(c.pinnedColumnIndex).toBe(3)
    c = setHidden(c, 'wide', true)
    expect(c.pinnedColumnIndex).toBeUndefined()
    expect(setHidden(c, 'title', true)).toBe(c)
    expect(visibleColumns(setAllHidden(c, true)).map((x) => x.id)).toEqual(['title'])
    expect(visibleColumns(setAllHidden(c, false))).toHaveLength(4)
  })

  test('wrap: unwrapping one column under wrap-all keeps the rest wrapped', () => {
    const c = setWrap(base(), 'note', false)
    expect(c.wrapAllContent).toBe(false)
    expect(isWrapped(c, 'note')).toBe(false)
    expect(isWrapped(c, 'qty')).toBe(true)
    expect(isWrapped(setWrapAll(c, false), 'qty')).toBe(false)
    expect(isWrapped(setWrapAll(c, true), 'note')).toBe(true)
  })

  test('move never moves or precedes the title; resize clamps', () => {
    const c = base()
    expect(moveColumn(c, 'qty', 'title').properties.map((x) => x.id)).toEqual(['title', 'qty', 'note', 'wide'])
    expect(moveColumn(c, 'wide', 'note').properties.map((x) => x.id)).toEqual(['title', 'wide', 'note', 'qty'])
    expect(moveColumn(c, 'title', 'note')).toBe(c)
    expect(setColWidth(c, 'note', 99).properties[1].colWidth).toBe(50)
  })
})
