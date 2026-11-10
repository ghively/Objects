import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, ConfirmRequiredError, ReadOnlyError, RevisionConflictError } from './client'
import { definitionHistoryApi, definitionPath } from './d2Api'

function answer(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

afterEach(() => vi.restoreAllMocks())

describe('definition history client', () => {
  test('lists, reads and restores on the definition routes', async () => {
    expect(definitionPath('queries', 'open-tasks')).toBe('.object/queries/open-tasks.json')
    let fetchSpy = answer(200, { versions: [{ id: 'b', number: 2, at: 'x', size: 1 }] })
    expect(await definitionHistoryApi.versions('.object/types/person.json')).toHaveLength(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/history/definition?path=.object%2Ftypes%2Fperson.json')
    fetchSpy.mockRestore()

    fetchSpy = answer(200, { id: 'b', text: '{}' })
    expect(await definitionHistoryApi.version('.object/types/person.json', 'b')).toEqual({ id: 'b', text: '{}' })
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/history/definition/version?path=.object%2Ftypes%2Fperson.json&id=b')
    fetchSpy.mockRestore()

    fetchSpy = answer(200, { revision: 'r2', rewritten: [], skipped: [] })
    expect((await definitionHistoryApi.restore('.object/types/person.json', 'b', 'r1', true)).revision).toBe('r2')
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/history/definition/restore')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ path: '.object/types/person.json', id: 'b', baseRevision: 'r1', confirm: true })
  })

  test('maps refusals to the app error classes', async () => {
    const restore = () => definitionHistoryApi.restore('.object/types/person.json', 'b', 'r1')
    answer(409, { currentRevision: 'r9' })
    await expect(restore()).rejects.toBeInstanceOf(RevisionConflictError)
    vi.restoreAllMocks()
    answer(428, { detail: 'This removes values.', affected: 2 })
    const err = await restore().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfirmRequiredError)
    expect((err as ConfirmRequiredError).affected).toBe(2)
    vi.restoreAllMocks()
    answer(423, { reason: 'Broken file', detail: 'Broken file' })
    await expect(restore()).rejects.toBeInstanceOf(ReadOnlyError)
    vi.restoreAllMocks()
    answer(404, { detail: 'There is no version "b".' })
    await expect(restore()).rejects.toEqual(new ApiError(404, 'There is no version "b".'))
  })
})
