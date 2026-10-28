import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { useLinkIndex } from '@/links/linkIndex'
import { activeTab, currentTarget, usePeek, useTabs, type Target } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { typeDef } from '@/test/mockApi'
import { openModeFor, openObject } from './createAndOpen'

const objT = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useSettings.setState({ settings: settingsDefaults })
  useLinkIndex.setState({ types: [typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks' })] })
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

describe('opening modes (M7)', () => {
  test('test shift click opens in side panel area 1', () => {
    openObject('Main.md')
    expect(openModeFor({ shiftKey: true })).toBe('sidepanel')
    expect(openObject('A.md', { shiftKey: true })).toBe('sidepanel')
    const tab = activeTab(s())!
    expect(tab.sidepanel).toHaveLength(1)
    expect(tab.sidepanel![0]).toMatchObject({ target: objT('A.md'), isOpen: true, panelArea: 'area1' })
    expect(currentTarget(s())).toEqual(objT('Main.md'))
    expect(usePeek.getState().path).toBeNull()
    // A Task with Shift goes to the side panel too.
    expect(openModeFor({ shiftKey: true }, 'task')).toBe('sidepanel')

    // Alt+Shift still peeks; Ctrl or Meta opens a new tab.
    expect(openObject('B.md', { shiftKey: true, altKey: true })).toBe('peek')
    expect(usePeek.getState().path).toBe('B.md')
    expect(openObject('C.md', { ctrlKey: true })).toBe('newTab')
    expect(openModeFor({ metaKey: true, shiftKey: true })).toBe('newTab')
    expect(s().tabs).toHaveLength(2)
  })

  test('test always open as full page opens tasks as pages', () => {
    expect(openModeFor({}, 'task')).toBe('peek')
    useSettings.setState({ settings: { ...settingsDefaults, alwaysOpenAsFullPage: true } })
    expect(openModeFor({}, 'task')).toBe('current')
    expect(openObject('Tasks/Do it.md', {}, 'task')).toBe('current')
    expect(currentTarget(s())).toEqual(objT('Tasks/Do it.md'))
    expect(usePeek.getState().path).toBeNull()
    // Alt+Shift still opens the peek.
    expect(openModeFor({ altKey: true, shiftKey: true }, 'task')).toBe('peek')
  })
})
