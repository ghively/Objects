import { afterEach, expect, test, vi } from 'vitest'
import { api } from '@/api/client'
import type { ObjectSummary } from '@/api/types'
import { typeDef } from '@/test/mockApi'
import { invalidateLinkIndex, resetLinkIndex, typeOf, useLinkIndex } from './linkIndex'

afterEach(() => {
  vi.restoreAllMocks()
  resetLinkIndex()
})

const summary = (title: string) => ({ path: `${title}.md`, type: 'page', title, tags: [] }) as unknown as ObjectSummary
type SpaceAnswer = Awaited<ReturnType<typeof api.space>>

test('invalidating during a load fetches again instead of joining the stale request', async () => {
  resetLinkIndex()
  let objects = [summary('A')]
  const releases: (() => void)[] = []
  vi.spyOn(api, 'space').mockImplementation(async () => ({ types: [] }) as unknown as SpaceAnswer)
  vi.spyOn(api, 'objects').mockImplementation(() => {
    const snap = [...objects]
    return new Promise((r) => releases.push(() => r(snap)))
  })
  const first = useLinkIndex.getState().load()
  // B is created while the first load is in flight; the app invalidates the index.
  objects = [...objects, summary('B')]
  const second = invalidateLinkIndex()
  await vi.waitFor(() => expect(releases.length).toBe(2))
  // The fresh request answers first, then the stale one: the stale answer must not win.
  releases[1]()
  await second
  releases[0]()
  await first
  expect(useLinkIndex.getState().objects.map((o) => o.path)).toEqual(['A.md', 'B.md'])
  expect(useLinkIndex.getState().loaded).toBe(true)
})

test('typeOf looks a type up by id without scanning the types per call', () => {
  const types = Array.from({ length: 50 }, (_, i) => typeDef({ id: `t${i}` }))
  const find = vi.spyOn(types, 'find')
  useLinkIndex.setState({ types })
  for (let i = 0; i < 5000; i++) expect(typeOf(`t${i % 50}`)?.id).toBe(`t${i % 50}`)
  expect(typeOf('nope')).toBeUndefined()
  expect(find).not.toHaveBeenCalled()
  // A new types array is a new map.
  useLinkIndex.setState({ types: [typeDef({ id: 't1', name: 'Renamed' })] })
  expect(typeOf('t1')?.name).toBe('Renamed')
  expect(typeOf('t2')).toBeUndefined()
})
