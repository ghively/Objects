// Audit 2026-11-07 #43: a debounced save of a collection's views that fails is told in a toast,
// not only logged.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { collection } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useDefs } from '@/types/useDefinitions'
import { COLLECTION_VIEWS_SAVE_FAILED, editCollectionViews, flushCollectionViews } from './useCollections'

const mocked = vi.mocked(api)
const toasts = () => document.querySelector('[data-editor-toasts]')?.textContent ?? ''

beforeEach(() => {
  mocked.saveCollection.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  useDefs.setState({ collections: [collection({ id: 'c1', name: 'Reading', revision: 'r1' })], queries: [], loaded: true })
})
afterEach(() => {
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
  vi.restoreAllMocks()
})

describe('editCollectionViews', () => {
  test('a save that fails shows a toast', async () => {
    mocked.saveCollection.mockRejectedValue(new ApiError(500, 'disk full'))
    editCollectionViews('c1', (v) => ({ ...v }))
    await flushCollectionViews('c1')
    expect(mocked.saveCollection).toHaveBeenCalledTimes(1)
    expect(toasts()).toContain(COLLECTION_VIEWS_SAVE_FAILED)
  })

  test('a save that lands shows none', async () => {
    mocked.saveCollection.mockImplementation(async (c) => ({ collection: { ...c, revision: 'r2' }, rewritten: [], skipped: [] }))
    editCollectionViews('c1', (v) => ({ ...v }))
    await flushCollectionViews('c1')
    expect(toasts()).toBe('')
  })
})
