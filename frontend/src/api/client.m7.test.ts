import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, DeviceSettings } from './types'
import { api, ApiError, CLIENT_ID, ConflictError } from './client'
import { attachment, deviceSettings, spaceEntry } from '@/test/mockApi'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function callOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[call] as unknown as [string, RequestInit | undefined]
}

function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(String(init?.body))
}

async function collect(run: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const seen: ChangeEvent[] = []
  const off = api.onChange((e) => seen.push(e))
  try {
    await run().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    off()
  }
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test client calls every M7 route with the contract shapes', () => {
  test('attachments lists', async () => {
    const list = [attachment({ path: 'Attachments/a.pdf' }), attachment({ path: 'Docs/b.mp3', kind: 'audio', size: 3 })]
    const fetchMock = respond(200, list)
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.attachments()).toEqual(list)
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/attachments')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  test('uploadAttachment sends raw bytes with ?name= and announces created', async () => {
    const fetchMock = respond(201, { path: 'Attachments/Report (2).pdf', kind: 'pdf' })
    vi.stubGlobal('fetch', fetchMock)
    const blob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' })
    let res: unknown
    const seen = await collect(async () => {
      res = await api.uploadAttachment(blob, 'Report.pdf')
    })
    expect(res).toEqual({ path: 'Attachments/Report (2).pdf', kind: 'pdf' })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/attachments?name=Report.pdf')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream')
    expect(init?.body).toBe(blob)
    expect(seen).toEqual([{ kind: 'created', path: 'Attachments/Report (2).pdf', version: null, origin: CLIENT_ID }])
  })

  test('uploadAttachment over the limit rejects with the 413 detail', async () => {
    vi.stubGlobal('fetch', respond(413, { detail: 'too large' }))
    const err = await api.uploadAttachment(new ArrayBuffer(1), 'big.bin').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(413)
    expect((err as ApiError).message).toBe('too large')
  })

  test('openAttachment posts the path', async () => {
    const fetchMock = respond(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.openAttachment('Attachments/a.pdf')).toEqual({ ok: true })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/attachments/open')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ path: 'Attachments/a.pdf' })
  })

  test('fileUrl is unchanged', () => {
    expect(api.fileUrl('Attachments/a b.pdf')).toBe('/api/file?path=Attachments%2Fa+b.pdf')
  })

  test('space returns the new fields; patchSpace sends patch, baseRevision and clientId', async () => {
    const info = { name: 'Work', root: '/w', types: [], icon: 'ph-star', description: null, hideTaskManagement: true, revision: 'r2' }
    const fetchMock = respond(200, info)
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.space()).toEqual(info)
    expect(await api.patchSpace({ name: 'Work', hideTaskManagement: true }, { baseRevision: 'r1' })).toEqual(info)
    const [url, init] = callOf(fetchMock, 1)
    expect(url).toBe('/api/space')
    expect(init?.method).toBe('PUT')
    expect(bodyOf(init)).toEqual({ patch: { name: 'Work', hideTaskManagement: true }, baseRevision: 'r1', clientId: CLIENT_ID })
  })

  test('patchSpace 409 throws ConflictError', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: { currentRevision: 'r9' } }))
    const err = await api.patchSpace({ name: 'x' }, { baseRevision: 'r1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).currentVersion).toBe('r9')
  })

  test('settings and patchSettings', async () => {
    const s: DeviceSettings = deviceSettings({ themeMode: 'light' })
    const fetchMock = respond(200, { settings: s, revision: 'r3' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.settings()).toEqual({ settings: s, revision: 'r3' })
    expect(callOf(fetchMock)[0]).toBe('/api/settings')
    expect(await api.patchSettings({ themeMode: 'light' }, { baseRevision: '' })).toEqual({ settings: s, revision: 'r3' })
    const [url, init] = callOf(fetchMock, 1)
    expect(url).toBe('/api/settings')
    expect(init?.method).toBe('PUT')
    expect(bodyOf(init)).toEqual({ patch: { themeMode: 'light' }, baseRevision: '' })
  })

  test('patchSettings 409 throws ConflictError', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: { currentRevision: 'r4' } }))
    const err = await api.patchSettings({ font: 'serif' }, { baseRevision: 'r1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
  })

  test('spaces unwraps the list', async () => {
    const entries = [spaceEntry({ path: '/a', current: true }), spaceEntry({ path: '/b', missing: true })]
    const fetchMock = respond(200, { spaces: entries })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.spaces()).toEqual(entries)
    expect(callOf(fetchMock)[0]).toBe('/api/spaces')
  })

  test('createSpace posts name and location; 409 keeps the server message', async () => {
    const fetchMock = respond(201, { path: '/home/me/Work' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.createSpace('Work', '/home/me')).toEqual({ path: '/home/me/Work' })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/spaces')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ name: 'Work', location: '/home/me' })

    vi.stubGlobal('fetch', respond(409, { detail: 'A folder with that name exists.' }))
    const err = await api.createSpace('Work', '/home/me').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(ConflictError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe('A folder with that name exists.')
  })

  test('openSpace posts the path', async () => {
    const fetchMock = respond(200, { path: '/b' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.openSpace('/b')).toEqual({ path: '/b' })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/spaces/open')
    expect(bodyOf(init)).toEqual({ path: '/b' })
  })

  test('removeSpace deletes by ?path=; the current space is a 409 ApiError', async () => {
    const fetchMock = respond(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.removeSpace('C:\\Spaces\\Old')).toEqual({ ok: true })
    const [url, init] = callOf(fetchMock)
    expect(init?.method).toBe('DELETE')
    expect(new URL(url, 'http://x').pathname).toBe('/api/spaces')
    expect(new URL(url, 'http://x').searchParams.get('path')).toBe('C:\\Spaces\\Old')

    vi.stubGlobal('fetch', respond(409, { detail: 'current' }))
    const err = await api.removeSpace('/a').catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(ConflictError)
    expect((err as ApiError).status).toBe(409)
  })

  test('switchSpace resolves on 202 and rejects on 503', async () => {
    const fetchMock = respond(202, { path: '/b' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.switchSpace('/b')).toEqual({ path: '/b' })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/spaces/switch')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ path: '/b' })

    vi.stubGlobal('fetch', respond(503, { detail: 'Switching spaces needs the Object launcher.' }))
    const err = await api.switchSpace('/b').catch((e: unknown) => e)
    expect((err as ApiError).status).toBe(503)
    expect((err as ApiError).message).toBe('Switching spaces needs the Object launcher.')
  })
})
