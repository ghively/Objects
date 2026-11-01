import { afterEach, expect, test, vi } from 'vitest'
import { graphData } from '@/test/mockApi'
import { api, resetGraphCache } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  resetGraphCache()
})

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } })

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>, call: number): Headers =>
  new Headers((fetchMock.mock.calls[call] as unknown as [string, RequestInit | undefined])[1]?.headers)

test('graph() revalidates with If-None-Match and a 304 returns the cached body with the same identity', async () => {
  const graph = graphData({ links: [0, 1], tagged: [] })
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(graph, { ETag: '"g1"' }))
    .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"g1"' } }))
    .mockResolvedValueOnce(json({ ...graph, links: [] }, { ETag: '"g2"' }))
  vi.stubGlobal('fetch', fetchMock)

  const first = await api.graph()
  expect(first).toEqual(graph)
  expect(sentHeaders(fetchMock, 0).has('If-None-Match')).toBe(false)

  const second = await api.graph()
  expect(sentHeaders(fetchMock, 1).get('If-None-Match')).toBe('"g1"')
  expect(second).toBe(first)

  const third = await api.graph()
  expect(sentHeaders(fetchMock, 2).get('If-None-Match')).toBe('"g1"')
  expect(third.links).toEqual([])
  expect(third).not.toBe(first)
})

test('graph() without an ETag from the server sends no If-None-Match and returns each body', async () => {
  const graph = graphData({ links: [0, 1], tagged: [] })
  const fetchMock = vi.fn(async () => json(graph))
  vi.stubGlobal('fetch', fetchMock)
  const a = await api.graph()
  const b = await api.graph()
  expect(a).toEqual(graph)
  expect(b).toEqual(graph)
  expect(sentHeaders(fetchMock, 1).has('If-None-Match')).toBe(false)
})
