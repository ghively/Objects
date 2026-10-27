import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { usePeek, useTabs, type Target } from '@/nav/tabs'
import { openModeFor, openObject } from './createAndOpen'

const objT = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
})

describe('openObject', () => {
  test('test openObject passes via from its modifiers to the tabs store', () => {
    const open = vi.spyOn(useTabs.getState(), 'open')
    openObject('A.md', { via: 'link' })
    expect(open).toHaveBeenLastCalledWith(objT('A.md'), { newTab: false, via: 'link' })
    openObject('B.md', { ctrlKey: true, via: 'link' })
    expect(open).toHaveBeenLastCalledWith(objT('B.md'), { newTab: true, via: 'link' })
    openObject('C.md')
    expect(open).toHaveBeenLastCalledWith(objT('C.md'), { newTab: false, via: undefined })
    open.mockRestore()
  })

  test('test openObject via link extends the trail, via nav resets it', () => {
    openObject('A.md')
    openObject('B.md', { via: 'link' })
    let t = s().tabs[0]
    expect(t.crumbs[t.index]).toEqual([objT('A.md')])
    openObject('C.md', { via: 'nav' })
    t = s().tabs[0]
    expect(t.crumbs[t.index]).toEqual([])
  })

  test('test peek modes do not touch the tabs', () => {
    expect(openModeFor({ altKey: true, shiftKey: true })).toBe('peek')
    openObject('A.md', { shiftKey: true, altKey: true, via: 'link' })
    expect(usePeek.getState().path).toBe('A.md')
    expect(s().tabs).toEqual([])
  })
})
