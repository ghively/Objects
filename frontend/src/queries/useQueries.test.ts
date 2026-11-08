// Audit 2026-11-07 #43: a debounced query save that fails is told in a toast, not only logged.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { query } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useDefs } from '@/types/useDefinitions'
import { editQuery, flushQuery, QUERY_SAVE_FAILED } from './useQueries'

const mocked = vi.mocked(api)
const toasts = () => document.querySelector('[data-editor-toasts]')?.textContent ?? ''

beforeEach(() => {
  mocked.saveQuery.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  useDefs.setState({ queries: [query({ id: 'q1', name: 'Open tasks', revision: 'r1' })], collections: [], loaded: true })
})
afterEach(() => {
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
  vi.restoreAllMocks()
})

describe('editQuery', () => {
  test('a save that fails shows a toast', async () => {
    mocked.saveQuery.mockRejectedValue(new ApiError(500, 'disk full'))
    editQuery('q1', (q) => ({ ...q, name: 'Renamed' }))
    await flushQuery('q1')
    expect(mocked.saveQuery).toHaveBeenCalledTimes(1)
    expect(toasts()).toContain(QUERY_SAVE_FAILED)
  })

  test('a save that lands shows none', async () => {
    mocked.saveQuery.mockImplementation(async (q) => ({ query: { ...q, revision: 'r2' } }))
    editQuery('q1', (q) => ({ ...q, name: 'Renamed' }))
    await flushQuery('q1')
    expect(toasts()).toBe('')
  })
})
