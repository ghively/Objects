import { describe, expect, test } from 'vitest'
import type { ImportMapping, ImportPlannedProperty, ImportPlannedType, TypeDef } from '@/api/types'
import {
  canReceiveImport,
  cleanMapping,
  cleanSourcePath,
  effectiveProperty,
  effectiveType,
  formatBytes,
  NEW_TYPE,
  seedMapping,
  withPropertyKind,
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

  test('test seed mapping keeps only how types are made (review finding 4)', () => {
    const served: ImportMapping = {
      typeSource: 'key',
      typeKey: 'kind',
      types: { 'folder:Pages': { name: 'Page (2)', pluralName: 'Pages (2)', skip: false } },
      properties: { 'folder:Pages': { rating: { kind: 'number', isArray: false, name: 'rating', skip: false } } },
    }
    expect(seedMapping(served)).toEqual({ typeSource: 'key', typeKey: 'kind', types: {}, properties: {} })
  })

  test('test effective property falls back to the latest preview', () => {
    const p = { key: 'rating', name: 'rating', kind: 'label', isArray: true, skip: false } as ImportPlannedProperty
    expect(effectiveProperty('t', p, BASE)).toEqual({ name: 'rating', kind: 'label', isArray: true, skip: false })
  })

  test('test a new kind sends no multiple values the user never set, and drops them for a single-value kind', () => {
    const m = withPropertyKind(BASE, 'folder:Books', 'rating', 'label')
    expect(cleanMapping(m, 'newSpace').properties).toEqual({ 'folder:Books': { rating: { kind: 'label' } } })
    const multi = withPropertyOverride(m, 'folder:Books', 'rating', { isArray: true })
    expect(cleanMapping(multi, 'newSpace').properties).toEqual({ 'folder:Books': { rating: { kind: 'label', isArray: true } } })
    expect(cleanMapping(withPropertyKind(multi, 'folder:Books', 'rating', 'entity'), 'newSpace').properties).toEqual({
      'folder:Books': { rating: { kind: 'entity', isArray: true } },
    })
    expect(cleanMapping(withPropertyKind(multi, 'folder:Books', 'rating', 'text'), 'newSpace').properties).toEqual({
      'folder:Books': { rating: { kind: 'text' } },
    })
  })

  test('test only types that take imported notes can be added to (review finding 5)', () => {
    const t = (id: string, name: string, basic: boolean, readOnlyReason: string | null = null) =>
      ({ id, name, basic, readOnlyReason }) as TypeDef
    const all = [
      t('page', 'Page', true),
      t('task', 'Task', true),
      t('tag', 'Tag', true),
      t('dailynote', 'DailyNote', true),
      t('whiteboard', 'Whiteboard', true),
      t('image', 'Image', true),
      t('file', 'File', true),
      t('audio', 'Audio', true),
      t('video', 'Video', true),
      t('weblink', 'Weblink', true),
      t('book', 'Book', false),
      t('broken', 'Broken', false, 'The type file is not valid JSON.'),
    ]
    expect(all.filter(canReceiveImport).map((x) => x.id)).toEqual(['page', 'task', 'book'])
  })

  test('test a pasted path loses surrounding quotes and spaces (review O4)', () => {
    expect(cleanSourcePath('  "C:\\Users\\gene\\Export.zip"  ')).toBe('C:\\Users\\gene\\Export.zip')
    expect(cleanSourcePath("'/home/gene/My Vault'")).toBe('/home/gene/My Vault')
    expect(cleanSourcePath(' " /home/gene/x.zip " ')).toBe('/home/gene/x.zip')
    // Quotes that don't surround the whole path stay.
    expect(cleanSourcePath('/home/gene/"x".zip')).toBe('/home/gene/"x".zip')
    expect(cleanSourcePath('"/home/gene/x.zip')).toBe('"/home/gene/x.zip')
    expect(cleanSourcePath('""')).toBe('')
  })

  test('test format bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(30 * 1024 * 1024)).toBe('30 MB')
  })
})
