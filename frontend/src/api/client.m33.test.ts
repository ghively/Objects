// M33 Contract: the two settings keys and the two title-heading routes.
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { api, RESYNC_PATH } from './client'
import type { ChangeEvent, DeviceSettings } from './types'
import { settingsDefaults } from '@/settings/defaults'
import { deviceSettings, mockApi } from '@/test/mockApi'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

/** The change events this window's listeners get while `run` and the next tick go by. */
async function eventsDuring(run: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const seen: ChangeEvent[] = []
  const off = api.onChange((e) => seen.push(e))
  try {
    await run()
    await new Promise((r) => setTimeout(r, 5))
  } finally {
    off()
  }
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M33 contract', () => {
  test('test the settings gain greaterThanMakes and windowButtons with their defaults', () => {
    expectTypeOf<DeviceSettings['greaterThanMakes']>().toEqualTypeOf<'toggle' | 'quote'>()
    expectTypeOf<DeviceSettings['windowButtons']>().toEqualTypeOf<'auto' | 'show' | 'hide'>()
    expect(settingsDefaults.greaterThanMakes).toBe('toggle')
    expect(settingsDefaults.windowButtons).toBe('auto')
    // The shared mock answers the same defaults.
    expect(deviceSettings().greaterThanMakes).toBe('toggle')
    expect(deviceSettings().windowButtons).toBe('auto')
  })

  test('test titleHeadings reads GET /api/space/title-headings', async () => {
    const fetchMock = respond(200, { count: 3 })
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.titleHeadings()).resolves.toEqual({ count: 3 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(url).toBe('/api/space/title-headings')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  test('test removeTitleHeadings posts to /api/space/title-headings/remove and announces a resync', async () => {
    const fetchMock = respond(200, { changed: 2 })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await eventsDuring(async () => {
      await expect(api.removeTitleHeadings()).resolves.toEqual({ changed: 2 })
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/space/title-headings/remove')
    expect(init.method).toBe('POST')
    // Open lists and notes refresh: the same "everything may have changed" an import's end sends.
    expect(seen).toEqual([{ kind: 'types', path: RESYNC_PATH, version: null, origin: null }])
  })

  test('test removeTitleHeadings announces nothing when nothing changed or the request failed', async () => {
    vi.stubGlobal('fetch', respond(200, { changed: 0 }))
    expect(await eventsDuring(() => api.removeTitleHeadings())).toEqual([])
    vi.stubGlobal('fetch', respond(423, { detail: 'This space is read-only.' }))
    expect(await eventsDuring(() => api.removeTitleHeadings().catch(() => undefined))).toEqual([])
  })

  test('test the shared mock answers the two routes', async () => {
    const mock = mockApi()
    await expect(mock.titleHeadings()).resolves.toEqual({ count: 0 })
    await expect(mock.removeTitleHeadings()).resolves.toEqual({ changed: 0 })
  })
})
