// 2026-11-09 (Gene): the sidebar can start collapsed ("Show the sidebar when Object opens"), and
// today's daily note pops out into the peek from the top bar, the palette and Ctrl+Shift+D.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'
import { deviceSettings, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, DailyNoteExistsError } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { setRecentSpace } from '@/nav/recent'
import { setTabsSpace, usePeek, useTabs } from '@/nav/tabs'
import { useSettings } from '@/settings/useSettings'
import App from './App'

const mocked = vi.mocked(api)
const ROOT = '/spaces/main'
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })

beforeEach(async () => {
  await setTabsSpace(null)
  await setRecentSpace(null)
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useSettings.setState({ loaded: false })
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 'main', root: ROOT, types: [PAGE] } as SpaceInfo)
  mocked.objects.mockResolvedValue([])
  mocked.settings.mockResolvedValue({ settings: deviceSettings(), revision: '' })
})

afterEach(async () => {
  await setTabsSpace(null)
  await setRecentSpace(null)
})

async function renderReady() {
  const utils = render(<App />)
  await waitFor(() => expect(document.title).toBe('main · Object'))
  return utils
}

const sidebar = () => document.querySelector('aside[aria-label="Sidebar"]')

describe('the sidebar on start', () => {
  test('shown by default', async () => {
    document.title = ''
    await renderReady()
    expect(sidebar()).not.toBeNull()
  })

  test('collapsed when "Show the sidebar when Object opens" is off; Toggle sidebar shows it', async () => {
    mocked.settings.mockResolvedValue({ settings: deviceSettings({ showSidebarOnStart: false }), revision: '' })
    document.title = ''
    await renderReady()
    await waitFor(() => expect(sidebar()).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(sidebar()).not.toBeNull()
  })
})

describe("today's daily note pops out", () => {
  test("the top bar's Today's note creates today's note and opens it in the peek", async () => {
    mocked.createDailyNote.mockResolvedValue({ path: 'DailyNotes/2026-11-09.md', version: 'v1', typeIds: [] })
    document.title = ''
    await renderReady()
    // M32: the empty tab is Home, which has its own "Today's note"; this is the top bar's.
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: "Today's note" }))
    await waitFor(() => expect(usePeek.getState().path).toBe('DailyNotes/2026-11-09.md'))
    expect(mocked.createDailyNote).toHaveBeenCalledTimes(1)
  })

  test("an existing note opens as it is; Ctrl+Shift+D does the same", async () => {
    mocked.createDailyNote.mockRejectedValue(new DailyNoteExistsError('exists', 'DailyNotes/2026-11-09.md', 'exists'))
    document.title = ''
    await renderReady()
    act(() => {
      fireEvent.keyDown(document.body, { key: 'D', ctrlKey: true, shiftKey: true })
    })
    await waitFor(() => expect(usePeek.getState().path).toBe('DailyNotes/2026-11-09.md'))
  })
})
