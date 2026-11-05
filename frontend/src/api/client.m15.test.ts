// M15 importers, the client side: what `startImport` sends, and the local resync the import dialog
// announces when a job finishes into this space (review finding 2).
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from './types'
import { announceResync, api, RESYNC_PATH } from './client'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M15 client', () => {
  test('start import sends the preview id, mapping and target and no client id', async () => {
    const fetchMock = respond(202, { jobId: 'j1', targetPath: '/space' })
    vi.stubGlobal('fetch', fetchMock)
    const req = {
      previewId: 'p1',
      mapping: { typeSource: 'folder' as const, typeKey: null, types: {}, properties: {} },
      target: { kind: 'currentSpace' as const },
    }
    expect(await api.startImport(req)).toEqual({ jobId: 'j1', targetPath: '/space' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/import/start')
    expect(JSON.parse(String(init.body))).toEqual(req)
  })

  test('announce resync tells this window every type and object may have changed, from no window', async () => {
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      announceResync()
      // Announced after the caller is done, as the other local announcements.
      expect(seen).toEqual([])
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      off()
    }
    expect(seen).toEqual([{ kind: 'types', path: RESYNC_PATH, version: null, origin: null }])
  })
})
