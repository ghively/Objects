import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'
import { deviceSettings, objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useCalendar } from '@/calendar/useCalendar'
import { resetLinkIndex } from '@/links/linkIndex'
import { setRecentSpace } from '@/nav/recent'
import { activeTab, currentTarget, setTabsSpace, usePeek, useTabs } from '@/nav/tabs'
import { useSettings } from '@/settings/useSettings'
import { useTabMenu } from '@/shell/TabMenu'
import App from './App'

const mocked = vi.mocked(api)
const ROOT = '/spaces/work'
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
const PATH = 'Pages/Notes.md'
const NOTES = objectSummary({ path: PATH, type: 'page', title: 'Notes' })

beforeEach(async () => {
  await setTabsSpace(null)
  await setRecentSpace(null)
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useTabMenu.getState().setOpen(false)
  useSettings.setState({ loaded: false })
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 'Work', root: ROOT, types: [PAGE] } as SpaceInfo)
  mocked.objects.mockResolvedValue([NOTES])
  mocked.object.mockImplementation(async () =>
    objectDetail({ summary: NOTES, frontmatter: { type: 'Page', title: 'Notes' }, body: 'Text.\n', version: 'v1' }),
  )
  mocked.settings.mockResolvedValue({ settings: deviceSettings(), revision: '' })
})

afterEach(async () => {
  await setTabsSpace(null)
  await setRecentSpace(null)
})

async function renderReady() {
  const utils = render(<App />)
  await waitFor(() => expect(document.title).toBe('Work · Object'))
  return utils
}

function key(k: string, mods: Partial<KeyboardEventInit> = {}) {
  act(() => {
    fireEvent.keyDown(document.body, { key: k, ...mods })
  })
}

describe('App, M7 tabs', () => {
  test('App stores tabs under the space root', async () => {
    useTabs.getState().open({ kind: 'trash' })
    document.title = ''
    await renderReady()
    expect(localStorage.getItem('object.tabs')).toBeNull()
    expect(localStorage.getItem(`object.tabs:${ROOT}`)).toContain('trash')
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'trash' })
  })

  test('test open on start modes', async () => {
    // lastOpenedPage (the default): the restored tabs.
    useTabs.getState().open({ kind: 'trash' })
    document.title = ''
    const first = await renderReady()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'trash' })
    first.unmount()

    // calendar
    mocked.settings.mockResolvedValue({
      settings: deviceSettings({ openOnStart: { [ROOT]: { mode: 'calendar' } } }),
      revision: '',
    })
    useSettings.setState({ loaded: false })
    document.title = ''
    const second = await renderReady()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    second.unmount()

    // today: the Calendar's Day view on today
    useTabs.getState().open({ kind: 'trash' })
    useCalendar.getState().setView('month')
    useCalendar.getState().setAnchor('2001-01-01')
    mocked.settings.mockResolvedValue({
      settings: deviceSettings({ openOnStart: { [ROOT]: { mode: 'today' } } }),
      revision: '',
    })
    useSettings.setState({ loaded: false })
    document.title = ''
    const third = await renderReady()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    expect(useCalendar.getState().view).toBe('day')
    expect(useCalendar.getState().anchor).not.toBe('2001-01-01')
    third.unmount()

    // specificObject, and another space's choice does not apply
    mocked.settings.mockResolvedValue({
      settings: deviceSettings({
        openOnStart: { [ROOT]: { mode: 'specificObject', path: PATH }, '/elsewhere': { mode: 'calendar' } },
      }),
      revision: '',
    })
    useSettings.setState({ loaded: false })
    document.title = ''
    await renderReady()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: PATH })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument()
  })

  test('test tab shortcuts close, open, cycle and navigate', async () => {
    const s = useTabs.getState
    s().open({ kind: 'trash' })
    s().open({ kind: 'allNotes' })
    s().open({ kind: 'queries' }, { newTab: true })
    document.title = ''
    await renderReady()
    const [a, b] = s().tabs.map((t) => t.id)
    expect(s().activeId).toBe(b)

    // navigateTabs (Ctrl+Tab) cycles, wrapping.
    key('Tab', { ctrlKey: true })
    expect(s().activeId).toBe(a)
    key('Tab', { ctrlKey: true })
    expect(s().activeId).toBe(b)

    // navigateBack / navigateForward (Object: Mod+Left or Mod+[ / Mod+Right or Mod+]) stay in the tab.
    s().activate(a)
    key('ArrowLeft', { ctrlKey: true })
    expect(currentTarget(s())).toEqual({ kind: 'trash' })
    key('ArrowRight', { ctrlKey: true })
    expect(currentTarget(s())).toEqual({ kind: 'allNotes' })
    key('[', { ctrlKey: true })
    expect(currentTarget(s())).toEqual({ kind: 'trash' })
    key(']', { ctrlKey: true })
    expect(currentTarget(s())).toEqual({ kind: 'allNotes' })
    // Alt+Left is no longer back.
    key('ArrowLeft', { altKey: true })
    expect(currentTarget(s())).toEqual({ kind: 'allNotes' })

    // openTabList (Object: Mod+Shift+Up) toggles the tab menu.
    key('ArrowUp', { ctrlKey: true, shiftKey: true })
    expect(useTabMenu.getState().open).toBe(true)
    expect(await screen.findByRole('textbox', { name: 'Search tabs' })).toBeInTheDocument()
    act(() => useTabMenu.getState().setOpen(false))

    // openNewTab (Mod+T) and closeTab (Mod+W).
    key('t', { ctrlKey: true })
    expect(s().tabs).toHaveLength(3)
    expect(currentTarget(s())).toEqual({ kind: 'allNotes' })
    key('w', { ctrlKey: true })
    expect(s().tabs).toHaveLength(2)

    // A pinned tab is not closed by the shortcut.
    s().pin(s().activeId!)
    key('w', { ctrlKey: true })
    expect(s().tabs).toHaveLength(2)
    expect(activeTab(s())!.pinned).toBe(true)
  })
})
