import { describe, expect, test } from 'vitest'
import { KIND_TRANSFORMS, PROPERTY_TYPES } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'
import { THEME_COLORS } from '@/theme/palette'
import { KIND_META } from './kinds'
import {
  addProperty,
  allowedKindChanges,
  keyForName,
  moveProperty,
  removeProperty,
  setNumberFormat,
  setSeparators,
  updateProperty,
} from './typeEdits'

const NUM = propertyDef({ id: 'p-n', key: 'amount', name: 'Amount', type: 'number' })

describe('typeEdits', () => {
  test('test addProperty creates unique camelCase key, avoids reserved keys, and default icon', () => {
    let t = typeDef({ id: 'project', propertyDefinitions: [propertyDef({ id: 'p1', key: 'dueDate', name: 'Due' })] })
    t = addProperty(t, 'datetime', { name: 'Due date' })
    const due = t.propertyDefinitions[1]
    expect(due.key).toBe('dueDate_')
    expect(due.name).toBe('Due date')
    expect(due.icon).toEqual({ type: 'iconify', val: KIND_META.datetime.icon })
    expect(due.id).not.toBe('p1')

    t = addProperty(t, 'textBlock', { name: 'Type' })
    expect(t.propertyDefinitions[2].key).toBe('type_')
    t = addProperty(t, 'textBlock', { name: 'type' })
    expect(t.propertyDefinitions[3].key).toBe('type_2')
    t = addProperty(t, 'number', { name: 'Total cost (EUR)' })
    expect(t.propertyDefinitions[4].key).toBe('totalCostEur')
    expect(keyForName(t, '')).toBe('property')
  })

  test('addProperty sets kind defaults and system properties use their own key as id', () => {
    let t = typeDef({ id: 'project' })
    t = addProperty(t, 'entity', { name: 'Owner', options: { allowedTypes: ['person'] } })
    expect(t.propertyDefinitions[0].options).toMatchObject({ isArray: true, allowedTypes: ['person'], hasFixedSet: false })
    t = addProperty(t, 'label', { name: 'Stage' })
    expect(t.propertyDefinitions[1].options).toMatchObject({ isArray: false, set: [] })
    t = addProperty(t, 'entity_description', { name: 'Description' })
    expect(t.propertyDefinitions[2]).toMatchObject({ id: 'description', key: 'description', type: 'entity_description' })
    t = addProperty(t, 'coverImage', { name: 'Cover Image' })
    expect(t.propertyDefinitions[3]).toMatchObject({ id: 'coverImage', key: 'coverImage' })
  })

  test('updateProperty, removeProperty and moveProperty', () => {
    const a = propertyDef({ id: 'a' })
    const b = propertyDef({ id: 'b' })
    const c = propertyDef({ id: 'c' })
    const t = typeDef({ id: 'x', propertyDefinitions: [a, b, c] })
    expect(updateProperty(t, 'b', { name: 'Bee' }).propertyDefinitions[1].name).toBe('Bee')
    expect(updateProperty(t, 'b', (d) => ({ ...d, visibility: 'hidden' })).propertyDefinitions[1].visibility).toBe('hidden')
    expect(removeProperty(t, 'b').propertyDefinitions.map((d) => d.id)).toEqual(['a', 'c'])
    expect(moveProperty(t, 'a', 2).propertyDefinitions.map((d) => d.id)).toEqual(['b', 'c', 'a'])
    expect(moveProperty(t, 'c', 0).propertyDefinitions.map((d) => d.id)).toEqual(['c', 'a', 'b'])
    // The input is never mutated.
    expect(t.propertyDefinitions.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  test('test setNumberFormat currency sets decimals 2/2; progress sets steps 10; none removes', () => {
    const cur = setNumberFormat(NUM, { currency: 'EUR' })
    expect(cur.options.numberFormat).toEqual({ type: 'currency', options: { currency: 'EUR', decimals: { min: 2, max: 2 } } })
    const prog = setNumberFormat(cur, 'progress')
    expect(prog.options.numberFormat?.type).toBe('progress')
    expect(prog.options.numberFormat?.options.progress?.steps).toBe(10)
    expect(THEME_COLORS).toContain(prog.options.numberFormat?.options.progress?.color)
    expect(prog.options.numberFormat?.options.currency).toBeUndefined()
    const pct = setNumberFormat(setSeparators(prog, { isRadixComma: true }), 'percentage')
    expect(pct.options.numberFormat?.options.progress).toBeUndefined()
    expect(pct.options.numberFormat?.options.separators).toEqual({ isRadixComma: true })
    expect(setNumberFormat(pct, 'none').options.numberFormat).toBeUndefined()
  })

  test('setSeparators creates a number format when there is none', () => {
    const d = setSeparators(NUM, { isGroupingThousands: false })
    expect(d.options.numberFormat).toEqual({ type: 'number', options: { separators: { isGroupingThousands: false } } })
  })

  test('test allowedKindChanges matches KIND_TRANSFORMS', () => {
    for (const k of PROPERTY_TYPES) expect(allowedKindChanges(k)).toEqual(KIND_TRANSFORMS[k])
    expect(allowedKindChanges('entity')).toEqual(['label', 'text', 'textBlock'])
    expect(allowedKindChanges('blocks')).toEqual([])
  })
})
