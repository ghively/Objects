import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError, CLIENT_ID, ConflictError, ReadOnlyError, RevisionConflictError } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { inkClient } from './inkClient'
import type { InkStroke } from './types'

function respond(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const strokes: InkStroke[] = [
  { id: 's1', tool: 'pen', color: '#3f80eb', width: 4, points: [[0, 0, 0.5]], d: 'M 0 0 Z', colorName: 'blue' },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ink client', () => {
  test('load gets the ink for a path', async () => {
    const fetch = respond(200, { path: 'Whiteboards/A b.md', strokes, revision: 'r1' })
    vi.stubGlobal('fetch', fetch)
    const res = await inkClient.load('Whiteboards/A b.md')
    expect(res.revision).toBe('r1')
    expect(res.strokes).toEqual(strokes)
    expect(fetch.mock.calls[0][0]).toBe('/api/whiteboard/ink?path=Whiteboards%2FA%20b.md')
    expect(fetch.mock.calls[0][1]?.method ?? 'GET').toBe('GET')
  })

  test('ink client maps 409, 423 and sends clientId', async () => {
    const ok = respond(200, { revision: 'r2' })
    vi.stubGlobal('fetch', ok)
    await expect(inkClient.save('Whiteboards/A.md', strokes, 'r1')).resolves.toEqual({ revision: 'r2' })
    const [url, init] = ok.mock.calls[0]
    expect(url).toBe('/api/whiteboard/ink')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      path: 'Whiteboards/A.md',
      strokes,
      baseRevision: 'r1',
      clientId: CLIENT_ID,
    })

    vi.stubGlobal('fetch', respond(409, { currentRevision: 'server-rev' }))
    const conflict = await inkClient.save('Whiteboards/A.md', strokes, 'r1').catch((e: unknown) => e)
    expect(conflict).toBeInstanceOf(ConflictError)
    expect(conflict).toBeInstanceOf(RevisionConflictError)
    expect((conflict as RevisionConflictError).currentRevision).toBe('server-rev')
    expect((conflict as ConflictError).currentVersion).toBe('server-rev')

    vi.stubGlobal('fetch', respond(423, { reason: 'foreign', detail: 'This ink file is read-only.' }))
    const ro = await inkClient.save('Whiteboards/A.md', strokes, 'r1').catch((e: unknown) => e)
    expect(ro).toBeInstanceOf(ReadOnlyError)
    expect((ro as ReadOnlyError).reason).toBe('foreign')

    vi.stubGlobal('fetch', respond(422, { detail: 'Stroke s1 has a bad colour.' }))
    const bad = await inkClient.save('Whiteboards/A.md', strokes, 'r1').catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(ApiError)
    expect(bad).not.toBeInstanceOf(ConflictError)
    expect((bad as ApiError).status).toBe(422)
    expect((bad as ApiError).message).toBe('Stroke s1 has a bad colour.')

    vi.stubGlobal('fetch', respond(404, { detail: 'Not found' }))
    const missing = await inkClient.load('Whiteboards/Gone.md').catch((e: unknown) => e)
    expect((missing as ApiError).status).toBe(404)
  })

  test('an ink save that stamped the .md announces changed to this window', async () => {
    vi.stubGlobal('EventSource', class extends EventTarget { close() {} })
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      vi.stubGlobal('fetch', respond(200, { revision: 'r2', mdVersion: 'v2', mdBaseVersion: 'v1' }))
      await inkClient.save('Whiteboards/A.md', strokes, 'r1')
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      off()
    }
    expect(seen.map((e) => [e.kind, e.path, e.version])).toEqual([['changed', 'Whiteboards/A.md', 'v2']])
  })
})
