// Audit 2026-11-01 P3/F5: a changed object refreshes one summary (one `/api/rows` call), not the
// whole list; a full fetch keeps what is shown; lookups by path and id are per array; one shared
// `/api/space` request.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '@/api/client'
import type { ObjectSummary, Row } from '@/api/types'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { objectSummary } from '@/test/mockApi'
import { byIdOf, byPathOf, invalidateLinkIndex, refreshLinkIndex, resetLinkIndex, summaryOf, useLinkIndex } from './linkIndex'

type SpaceAnswer = Awaited<ReturnType<typeof api.space>>

const A = objectSummary({ path: 'Pages/A.md', id: 'a', title: 'A' })
const B = objectSummary({ path: 'Pages/B.md', id: 'b', title: 'B' })
const asRow = (summary: ObjectSummary): Row => ({ summary, version: 'v2', values: {}, links: {}, preview: '' })

beforeEach(() => {
  resetLinkIndex()
  resetSpaceInfo()
  vi.spyOn(api, 'space').mockImplementation(async () => ({ name: 's', root: '/s', types: [] }) as unknown as SpaceAnswer)
  vi.spyOn(api, 'objects').mockResolvedValue([A, B])
})
afterEach(() => {
  vi.restoreAllMocks()
  resetLinkIndex()
  resetSpaceInfo()
})

test('a changed object fetches only its row and is spliced in; the rest keep their identity', async () => {
  await useLinkIndex.getState().load()
  const before = useLinkIndex.getState()
  const rows = vi.spyOn(api, 'rows').mockResolvedValue([asRow({ ...A, title: 'A renamed' })])
  const objectsCalls = vi.mocked(api.objects).mock.calls.length
  await refreshLinkIndex(['Pages/A.md'])
  expect(rows).toHaveBeenCalledWith({ paths: ['Pages/A.md'], preview: false })
  expect(vi.mocked(api.objects).mock.calls.length).toBe(objectsCalls)
  const after = useLinkIndex.getState()
  expect(after.objects.map((o) => o.title)).toEqual(['A renamed', 'B'])
  expect(after.objects[1]).toBe(before.objects[1])
  expect(after.types).toBe(before.types)
  expect(after.loaded).toBe(true)
  expect(after.revision).toBe(before.revision + 1)
  expect(summaryOf('Pages/A.md')?.title).toBe('A renamed')
})

test('an unchanged row changes nothing; an unknown path joins the index', async () => {
  await useLinkIndex.getState().load()
  const before = useLinkIndex.getState()
  vi.spyOn(api, 'rows').mockResolvedValueOnce([asRow(A)])
  await refreshLinkIndex(['Pages/A.md'])
  expect(useLinkIndex.getState().objects).toBe(before.objects)
  const C = objectSummary({ path: 'Pages/C.md', id: 'c', title: 'C' })
  vi.spyOn(api, 'rows').mockResolvedValueOnce([asRow(C)])
  await refreshLinkIndex(['Pages/C.md'])
  expect(useLinkIndex.getState().objects.map((o) => o.path)).toEqual(['Pages/A.md', 'Pages/B.md', 'Pages/C.md'])
  expect(byIdOf(useLinkIndex.getState().objects).get('c')).toBe(C)
})

test('a full fetch keeps what is shown until the answer and keeps unchanged types by identity', async () => {
  await useLinkIndex.getState().load()
  const before = useLinkIndex.getState()
  let release: () => void = () => undefined
  vi.mocked(api.objects).mockImplementationOnce(() => new Promise((r) => (release = () => r([A]))))
  const p = invalidateLinkIndex()
  expect(useLinkIndex.getState().loaded).toBe(true)
  expect(useLinkIndex.getState().objects).toBe(before.objects)
  release()
  await p
  expect(useLinkIndex.getState().objects.map((o) => o.path)).toEqual(['Pages/A.md'])
  expect(useLinkIndex.getState().types).toBe(before.types)
})

test('lookups by path and id are built once per objects array', async () => {
  await useLinkIndex.getState().load()
  const { objects } = useLinkIndex.getState()
  expect(byPathOf(objects)).toBe(byPathOf(objects))
  expect(byPathOf(objects).get('Pages/B.md')).toBe(B)
  expect(byIdOf(objects).get('a')).toBe(A)
  expect(byPathOf([...objects])).not.toBe(byPathOf(objects))
})

test('the index and the space info share one /api/space request', async () => {
  const { useSpaceInfo } = await import('@/settings/useSpaceInfo')
  await Promise.all([useLinkIndex.getState().load(), useSpaceInfo.getState().ensure()])
  expect(vi.mocked(api.space)).toHaveBeenCalledTimes(1)
  expect(useSpaceInfo.getState().space?.root).toBe('/s')
  // A later full fetch (a type changed) asks again: the types must be fresh.
  await invalidateLinkIndex()
  expect(vi.mocked(api.space)).toHaveBeenCalledTimes(2)
})
