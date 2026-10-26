import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from './types'
import { api, CLIENT_ID, ConflictError } from './client'
import { collection } from '@/test/mockApi'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string)
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
  return (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[0]
}

async function collect(run: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const seen: ChangeEvent[] = []
  const off = api.onChange((e) => seen.push(e))
  try {
    await run()
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    off()
  }
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client M3', () => {
  test('saveCollection emits local collections event with own origin', async () => {
    const c = collection({ id: 'tooling', name: 'Tooling', revision: 'r1' })
    const fetchMock = respond(200, { collection: { ...c, revision: 'r2' }, rewritten: ['Servers/A.md'], skipped: [] })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await collect(() => api.saveCollection(c, { baseRevision: 'r1' }))
    expect(urlOf(fetchMock)).toBe('/api/collections/tooling')
    expect(bodyOf(fetchMock)).toMatchObject({ baseRevision: 'r1', clientId: CLIENT_ID })
    expect(seen).toEqual([
      { kind: 'collections', path: 'tooling', version: 'r2', origin: CLIENT_ID },
      { kind: 'changed', path: 'Servers/A.md', version: null, origin: CLIENT_ID },
    ])
  })

  test('rows posts scope and returns rows', async () => {
    const rows = [{ summary: { path: 'A.md' }, version: 'v1', values: {}, links: {}, preview: '' }]
    const fetchMock = respond(200, { rows })
    vi.stubGlobal('fetch', fetchMock)
    const scope = { typeIds: ['task'], search: { terms: ['ab'], mode: 'auto' as const } }
    await expect(api.rows(scope)).resolves.toEqual(rows)
    expect(urlOf(fetchMock)).toBe('/api/rows')
    expect(bodyOf(fetchMock)).toEqual(scope)
  })

  test('createObject sends values', async () => {
    const fetchMock = respond(201, { path: 'Tasks/X.md', version: 'v1' })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await collect(() => api.createObject('task', { title: 'X', values: { status: ['Done'] } }))
    expect(bodyOf(fetchMock)).toEqual({ typeId: 'task', title: 'X', values: { status: ['Done'] }, clientId: CLIENT_ID })
    expect(seen).toEqual([{ kind: 'created', path: 'Tasks/X.md', version: 'v1', origin: CLIENT_ID }])
  })

  test('patchUi sends baseRevision and emits ui event; 409 throws ConflictError', async () => {
    const fetchMock = respond(200, { ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'r2' })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await collect(() => api.patchUi({ allNotesLayout: 'grid' }, { baseRevision: 'r1' }))
    expect(bodyOf(fetchMock)).toEqual({ patch: { allNotesLayout: 'grid' }, baseRevision: 'r1', clientId: CLIENT_ID })
    expect(seen).toEqual([{ kind: 'ui', path: 'ui.json', version: 'r2', origin: CLIENT_ID }])

    vi.stubGlobal('fetch', respond(409, { detail: { currentRevision: 'r9' } }))
    const err = await api.patchUi({ pinned: [] }, { baseRevision: 'r1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).currentVersion).toBe('r9')
  })

  test('deleteCollection sends confirm and returns the result', async () => {
    const result = { trashId: 't1', removedFrom: ['A.md'], skipped: [] }
    const fetchMock = respond(200, result)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.deleteCollection('tooling', { confirm: true })).resolves.toEqual(result)
    expect(urlOf(fetchMock)).toBe(`/api/collections/tooling?confirm=true&clientId=${CLIENT_ID}`)
  })
})
