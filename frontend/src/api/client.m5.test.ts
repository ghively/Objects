import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, GraphData, References, SearchResponse } from './types'
import { api, CLIENT_ID, ConflictError } from './client'
import { graphData, references, searchResult } from '@/test/mockApi'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function callOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[call] as unknown as [string, RequestInit | undefined]
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

describe('api client M5', () => {
  test('test search builds repeated type params and passes the abort signal', async () => {
    const body: SearchResponse = { results: [searchResult({ path: 'Pages/Café.md', titleMatches: [[0, 4]] })], partial: true }
    const fetchMock = respond(200, body)
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()
    const res = await api.search('café & co', {
      types: ['a', 'b'],
      excludeTypes: ['c'],
      tag: 'Work stuff',
      limit: 20,
      mode: 'title',
      signal: ctrl.signal,
    })
    expect(res).toEqual(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = callOf(fetchMock)
    const u = new URL(url, 'http://x')
    expect(u.pathname).toBe('/api/search')
    expect(u.searchParams.get('q')).toBe('café & co')
    expect(u.searchParams.getAll('type')).toEqual(['a', 'b'])
    expect(u.searchParams.getAll('excludeType')).toEqual(['c'])
    expect(u.searchParams.get('tag')).toBe('Work stuff')
    expect(u.searchParams.get('limit')).toBe('20')
    expect(u.searchParams.get('mode')).toBe('title')
    expect(url).toContain('type=a&type=b&excludeType=c')
    expect(init?.signal).toBe(ctrl.signal)

    // Without options: only q.
    await api.search('x')
    expect(callOf(fetchMock, 1)[0]).toBe('/api/search?q=x')
  })

  test('test references, graph and reindex call their routes', async () => {
    const refs: References = references({ tabs: ['all', 'backlinks', 'related'] })
    let fetchMock = respond(200, refs)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.references('Pages/A b.md', { relatedLimit: 40 })).resolves.toEqual(refs)
    const u = new URL(callOf(fetchMock)[0], 'http://x')
    expect(u.pathname).toBe('/api/references')
    expect(u.searchParams.get('path')).toBe('Pages/A b.md')
    expect(u.searchParams.get('relatedLimit')).toBe('40')
    await api.references('Pages/A.md')
    expect(callOf(fetchMock, 1)[0]).toBe('/api/references?path=Pages%2FA.md')

    const graph: GraphData = graphData({ links: [0, 1], tagged: [] })
    fetchMock = respond(200, graph)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.graph()).resolves.toEqual(graph)
    expect(callOf(fetchMock)[0]).toBe('/api/graph')

    fetchMock = respond(202, { started: true })
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.reindex()).resolves.toEqual({ started: true })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/search/reindex')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ clientId: CLIENT_ID })
  })

  test('test linkMention 409 throws ConflictError and success emits changed', async () => {
    const input = { path: 'Pages/B.md', target: 'Pages/A.md', start: 4, end: 9, text: 'Alpha', baseVersion: 'v1' }
    let fetchMock = respond(409, { detail: { currentVersion: 'v9' } })
    vi.stubGlobal('fetch', fetchMock)
    const failed = api.linkMention(input)
    await expect(failed).rejects.toBeInstanceOf(ConflictError)
    await expect(failed).rejects.toMatchObject({ currentVersion: 'v9' })
    expect(await collect(() => api.linkMention(input))).toEqual([])

    fetchMock = respond(200, { version: 'v2' })
    vi.stubGlobal('fetch', fetchMock)
    let res: unknown
    const seen = await collect(async () => {
      res = await api.linkMention(input)
    })
    expect(res).toEqual({ version: 'v2' })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/references/link')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ ...input, clientId: CLIENT_ID })
    expect(seen).toEqual([{ kind: 'changed', path: 'Pages/B.md', version: 'v2', origin: CLIENT_ID }])
  })

  test('test patchUi sends the graph customization', async () => {
    const fetchMock = respond(200, { ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'r2' })
    vi.stubGlobal('fetch', fetchMock)
    await api.patchUi({ graph: { showCompletedTasks: true, excludeTypeIds: ['task'] } }, { baseRevision: 'r1' })
    expect(JSON.parse(callOf(fetchMock)[1]?.body as string).patch).toEqual({
      graph: { showCompletedTasks: true, excludeTypeIds: ['task'] },
    })
  })
})
