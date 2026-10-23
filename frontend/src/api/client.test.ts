import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from './types'
import { api, ApiError, CLIENT_ID } from './client'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  test('a save that wrote is announced to other listeners in this window', async () => {
    const fetchMock = respond(200, { version: 'v2' })
    vi.stubGlobal('fetch', fetchMock)
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      await expect(api.saveBody('Pages/A.md', 'x', 'v1')).resolves.toEqual({ version: 'v2' })
      const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
      expect(sent).toEqual({ path: 'Pages/A.md', body: 'x', baseVersion: 'v1', clientId: CLIENT_ID })
      expect(seen).toEqual([]) // after the caller has handled the result
      await new Promise((r) => setTimeout(r, 0))
      expect(seen).toEqual([{ kind: 'changed', path: 'Pages/A.md', version: 'v2', origin: CLIENT_ID }])

      // An unchanged body (same version back) is not a change.
      vi.stubGlobal('fetch', respond(200, { version: 'v2' }))
      await api.saveBody('Pages/A.md', 'x', 'v2')
      await new Promise((r) => setTimeout(r, 0))
      expect(seen).toHaveLength(1)
    } finally {
      off()
    }
  })

  test("errors carry the server's detail message", async () => {
    vi.stubGlobal('fetch', respond(404, { detail: "No object at 'X.md'" }))
    const err = await api.object('X.md').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).toBe("No object at 'X.md'")
  })
})
