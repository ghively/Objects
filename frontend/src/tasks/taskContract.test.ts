import { afterEach, describe, expect, test, vi } from 'vitest'
import { ConflictError } from '@/api/client'
import { taskClient } from './taskContract'

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, statusText: 'x', text: async () => JSON.stringify(body) })

afterEach(() => vi.unstubAllGlobals())

describe('taskClient (the contract routes until api has them)', () => {
  test('calls the contract routes with the contract bodies', async () => {
    const fetch = reply(200, { count: 0 })
    vi.stubGlobal('fetch', fetch)
    await taskClient.overdue('Tasks/A b.md')
    expect(fetch.mock.calls[0][0]).toBe('/api/tasks/overdue?path=Tasks%2FA%20b.md')
    await taskClient.taskStats('Tasks/A.md')
    expect(fetch.mock.calls[1][0]).toBe('/api/tasks/stats?path=Tasks%2FA.md')
    await taskClient.occurrence('Tasks/A.md', 'skip', { catchUp: 'advanceOne', baseVersion: 'v3' })
    const [url, init] = fetch.mock.calls[2]
    expect(url).toBe('/api/tasks/occurrence')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ path: 'Tasks/A.md', action: 'skip', catchUp: 'advanceOne', baseVersion: 'v3' })
  })

  test('a stale version is a ConflictError', async () => {
    vi.stubGlobal('fetch', reply(409, { detail: { currentVersion: 'v9' } }))
    await expect(taskClient.occurrence('Tasks/A.md', 'excuse', { baseVersion: 'v1' })).rejects.toBeInstanceOf(ConflictError)
  })
})
