import { it, expect, vi } from 'vitest'
import { api } from '@/api/client'
import { useLinkIndex, invalidateLinkIndex, resetLinkIndex } from '@/links/linkIndex'

it('invalidate during in-flight load keeps stale list', async () => {
  resetLinkIndex()
  let objects: any[] = [{ path: 'A.md', type: 'page', title: 'A', tags: [] }]
  let release: (() => void) | null = null
  vi.spyOn(api, 'space').mockImplementation(async () => ({ types: [] }) as any)
  vi.spyOn(api, 'objects').mockImplementation(() => {
    const snap = [...objects]
    return new Promise((r) => { release = () => r(snap as any) })
  })
  const p1 = useLinkIndex.getState().load()
  // B is created while the first load is in flight; App's change handler invalidates.
  objects = [...objects, { path: 'B.md', type: 'page', title: 'B', tags: [] }]
  const p2 = invalidateLinkIndex()
  await Promise.resolve(); await Promise.resolve()
  release!()
  await p1; await p2
  console.log('objects after invalidate:', useLinkIndex.getState().objects.map((o) => o.path), 'objects() calls:', (api.objects as any).mock.calls.length)
})
