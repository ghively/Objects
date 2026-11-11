import { describe, expect, test } from 'vitest'
import { typeDef } from '@/test/mockApi'
import { applyOption, buildSearchOptions, nameMatches, NO_FILTERS, PALETTE_TEXT } from './searchOptions'

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People' })
const PROJECT = typeDef({ id: 'project', name: 'Project', pluralName: 'Projects' })
const TYPES = [PAGE, PERSON, PROJECT]

describe('nameMatches', () => {
  test('prefix, word prefixes and substrings, case-insensitive', () => {
    expect(nameMatches('pe', 'Person')).toBe(true)
    expect(nameMatches('PEO', 'People')).toBe(true)
    expect(nameMatches('mee no', 'Meeting notes')).toBe(true)
    expect(nameMatches('son', 'Person')).toBe(true)
    expect(nameMatches('so', 'Person')).toBe(false)
    expect(nameMatches('xyz', 'Person')).toBe(false)
    expect(nameMatches('  ', 'Person')).toBe(false)
  })
})

describe('buildSearchOptions', () => {
  test('nothing for an empty query', () => {
    expect(buildSearchOptions('  ', TYPES, ['work'], NO_FILTERS)).toEqual([])
  })

  test('create uses Page by default and the filter type when set', () => {
    const [first] = buildSearchOptions('Hello', TYPES, [], NO_FILTERS)
    expect(first).toMatchObject({ kind: 'create', typeId: 'page', title: 'Hello', label: 'Create new Note with title "Hello"' })
    const [withFilter] = buildSearchOptions('Hello', TYPES, [], { ...NO_FILTERS, types: ['person'] })
    expect(withFilter).toMatchObject({ kind: 'create', typeId: 'person', label: 'Create new Person with title "Hello"' })
  })

  test('type include and exclude for name or plural matches, by whole query or last word', () => {
    const opts = buildSearchOptions('peo', TYPES, [], NO_FILTERS)
    expect(opts.map((o) => o.label)).toEqual([
      'Create new Note with title "peo"',
      'Only search for type "Person"',
      'Exclude type "Person"',
    ])
    const lastWord = buildSearchOptions('alpha proj', TYPES, [], NO_FILTERS)
    expect(lastWord.find((o) => o.kind === 'includeType')).toMatchObject({ typeId: 'project', rest: 'alpha' })
  })

  test('types already filtered and a set tag filter are not offered again', () => {
    const opts = buildSearchOptions('p', TYPES, ['planning'], { types: ['person'], excludeTypes: ['project'], tag: 'x' })
    expect(opts.filter((o) => o.kind === 'includeType').map((o) => o.typeId)).toEqual(['page'])
    expect(opts.some((o) => o.kind === 'tag')).toBe(false)
  })

  test('tag options match tag names', () => {
    const opts = buildSearchOptions('wor', TYPES, ['work', 'Work', 'world', 'home'], NO_FILTERS)
    expect(opts.filter((o) => o.kind === 'tag').map((o) => o.label)).toEqual([
      'Limit results to the tag "work"',
      'Limit results to the tag "world"',
    ])
  })
})

test('applyOption adds the filter', () => {
  const [, inc, exc] = buildSearchOptions('person', TYPES, [], NO_FILTERS)
  expect(applyOption(NO_FILTERS, inc)).toEqual({ ...NO_FILTERS, types: ['person'] })
  expect(applyOption(NO_FILTERS, exc)).toEqual({ ...NO_FILTERS, excludeTypes: ['person'] })
  const tag = buildSearchOptions('work', [], ['work'], NO_FILTERS)[0]
  expect(applyOption(NO_FILTERS, tag)).toEqual({ ...NO_FILTERS, tag: 'work' })
})

test('string builders', () => {
  expect(PALETTE_TEXT.emptyTitle('zz')).toBe('No results for "zz"')
})
