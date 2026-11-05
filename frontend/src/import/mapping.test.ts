import { describe, expect, test } from 'vitest'
import type { ImportMapping, ImportPlannedType } from '@/api/types'
import {
  cleanMapping,
  effectiveType,
  formatBytes,
  NEW_TYPE,
  withPropertyOverride,
  withTypeOverride,
  withTypeSource,
} from './mapping'

const BASE: ImportMapping = { typeSource: 'folder', typeKey: null, types: {}, properties: {} }

describe('import mapping helpers', () => {
  test('test clean mapping trims names, drops empty overrides and false flags', () => {
    let m = withTypeOverride(BASE, 'folder:Books', { name: '  Book  ', pluralName: '   ', skip: false })
    m = withTypeOverride(m, 'folder:Notes', { skip: false })
    m = withPropertyOverride(m, 'folder:Books', 'rating', { kind: 'number', name: '' })
    m = withPropertyOverride(m, 'folder:Books', 'genre', { skip: false })
    m = withPropertyOverride(m, 'folder:Books', 'tags', { kind: 'label', isArray: false })
    expect(cleanMapping(m, 'newSpace')).toEqual({
      typeSource: 'folder',
      typeKey: null,
      types: { 'folder:Books': { name: 'Book' } },
      properties: { 'folder:Books': { rating: { kind: 'number' }, tags: { kind: 'label', isArray: false } } },
    })
  })

  test('test existing type only goes with the current space target', () => {
    const m = withTypeOverride(BASE, 'page', { existingTypeId: NEW_TYPE })
    expect(cleanMapping(m, 'newSpace').types).toEqual({})
    expect(cleanMapping(m, 'currentSpace').types).toEqual({ page: { existingTypeId: '' } })
  })

  test('test type key is sent only for key mapping', () => {
    expect(cleanMapping({ ...BASE, typeKey: 'type' }, 'newSpace').typeKey).toBeNull()
    expect(cleanMapping({ ...BASE, typeSource: 'key', typeKey: 'type' }, 'newSpace').typeKey).toBe('type')
  })

  test('test a new type source drops every override', () => {
    const m = withPropertyOverride(withTypeOverride(BASE, 'folder:A', { name: 'X' }), 'folder:A', 'p', { skip: true })
    expect(withTypeSource(m, 'key', 'kind')).toEqual({ typeSource: 'key', typeKey: 'kind', types: {}, properties: {} })
    expect(withTypeSource({ ...m, typeKey: 'kind' }, 'none', null)).toEqual({
      typeSource: 'none',
      typeKey: 'kind',
      types: {},
      properties: {},
    })
  })

  test('test effective type shows an emptied name while typing', () => {
    const t = { key: 'page', name: 'Page', pluralName: 'Pages', skip: false, existingTypeId: 't-page' } as ImportPlannedType
    expect(effectiveType(t, BASE)).toEqual({ name: 'Page', pluralName: 'Pages', skip: false, existingTypeId: 't-page' })
    expect(effectiveType(t, withTypeOverride(BASE, 'page', { name: '', existingTypeId: NEW_TYPE }))).toMatchObject({
      name: '',
      existingTypeId: '',
    })
  })

  test('test format bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(30 * 1024 * 1024)).toBe('30 MB')
  })
})
