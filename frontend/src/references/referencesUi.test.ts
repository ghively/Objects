import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_REFERENCES_UI,
  loadReferencesUi,
  referencesKey,
  saveReferencesUi,
  splitAt,
  tabCount,
} from './referencesUi'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('referencesUi', () => {
  test('default state is the All tab, open', () => {
    expect(loadReferencesUi('obj-1')).toEqual({ tab: 'all', closed: false })
    expect(DEFAULT_REFERENCES_UI).toEqual({ tab: 'all', closed: false })
  })

  test('saves and loads per object under object.references:<id>', () => {
    saveReferencesUi('obj-1', { tab: 'mentions', closed: true })
    expect(localStorage.getItem('object.references:obj-1')).toBe(JSON.stringify({ tab: 'mentions', closed: true }))
    expect(referencesKey('Pages/A.md')).toBe('object.references:Pages/A.md')
    expect(loadReferencesUi('obj-1')).toEqual({ tab: 'mentions', closed: true })
    expect(loadReferencesUi('obj-2')).toEqual({ tab: 'all', closed: false })
  })

  test('bad stored values fall back to the default', () => {
    localStorage.setItem(referencesKey('x'), '{not json')
    expect(loadReferencesUi('x')).toEqual({ tab: 'all', closed: false })
    localStorage.setItem(referencesKey('y'), JSON.stringify({ tab: 'nope', closed: 'yes' }))
    expect(loadReferencesUi('y')).toEqual({ tab: 'all', closed: false })
  })

  test('blocked storage never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveReferencesUi('a', { tab: 'backlinks', closed: false })).not.toThrow()
    expect(loadReferencesUi('a')).toEqual({ tab: 'all', closed: false })
  })

  test('tab counts: objects per tab, their sum for All', () => {
    const data = {
      tabs: ['all', 'backlinks', 'related', 'mentions'] as const,
      backlinks: [1, 2],
      related: [1, 2, 3],
      mentions: [1],
      relatedTags: [1, 2, 3, 4],
    }
    const d = { ...data, tabs: [...data.tabs] }
    expect(tabCount('backlinks', d)).toBe(2)
    expect(tabCount('relatedTags', d)).toBe(4)
    // relatedTags is not offered, so All leaves it out.
    expect(tabCount('all', d)).toBe(6)
  })

  test('splitAt clamps the span', () => {
    expect(splitAt('hello world', 6, 11)).toEqual(['hello ', 'world', ''])
    expect(splitAt('abc', -3, 99)).toEqual(['', 'abc', ''])
    expect(splitAt('abc', 2, 1)).toEqual(['ab', '', 'c'])
    expect(splitAt('🚀 Ada', 2, 5)).toEqual(['🚀 ', 'Ada', ''])
  })
})
