import { afterEach, expect, test, vi } from 'vitest'
import { api } from '@/api/client'
import type { ObjectSummary } from '@/api/types'
import { invalidateLinkIndex, resetLinkIndex, useLinkIndex } from './linkIndex'

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
