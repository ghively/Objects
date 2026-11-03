// The open times kept beside the recent list (the search palette's Today / Earlier groups).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mergeRecentFromStorage, useRecent } from './recent'

beforeEach(() => {
  useRecent.getState().clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('recent open times', () => {
  test('add records when, also when reopening the newest entry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    useRecent.getState().add('A.md')
    vi.setSystemTime(2_000)
    useRecent.getState().add('B.md')
    vi.setSystemTime(3_000)
    useRecent.getState().add('B.md')
    expect(useRecent.getState().paths).toEqual(['B.md', 'A.md'])
    expect(useRecent.getState().openedAt).toEqual({ 'A.md': 1_000, 'B.md': 3_000 })
  })

  test('retarget carries the time; clear drops all', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    useRecent.getState().add('Old.md')
    useRecent.getState().retarget('Old.md', 'New.md')
    expect(useRecent.getState().openedAt).toEqual({ 'New.md': 5_000 })
    useRecent.getState().clear()
    expect(useRecent.getState().openedAt).toEqual({})
  })

  test('another window: the later time wins; nothing new merges to null', () => {
    const current = { paths: ['A.md'], openedAt: { 'A.md': 10 } }
    expect(mergeRecentFromStorage({ paths: ['A.md'], openedAt: { 'A.md': 5 } }, { paths: ['A.md'] }, current)).toBeNull()
    expect(mergeRecentFromStorage({ paths: ['A.md'], openedAt: { 'A.md': 20 } }, { paths: ['A.md'] }, current)).toEqual({
      paths: ['A.md'],
      openedAt: { 'A.md': 20 },
    })
    // Lists stored before open times existed still merge.
    expect(mergeRecentFromStorage({ paths: ['B.md', 'A.md'] }, { paths: ['A.md'] }, { paths: ['A.md'] })).toEqual({
      paths: ['B.md', 'A.md'],
      openedAt: {},
    })
  })
})
