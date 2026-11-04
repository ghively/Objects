import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/spaces/switchSpace', async (orig) => ({
  ...(await orig<typeof import('@/spaces/switchSpace')>()),
  switchSpace: vi.fn(async () => true),
}))

import { api } from '@/api/client'
import { useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { switchSpace } from '@/spaces/switchSpace'
import { spaceEntry, typeDef } from '@/test/mockApi'
import { ACTION_TEXT } from './actions'
import { CommandPalette, setFocusToggleForTests } from './CommandPalette'
import { PASTE_TEXT } from './paste'
import { PALETTE_TEXT } from './searchOptions'
import { usePalette } from './usePalette'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })

beforeAll(() => {
  Element.prototype.scrollIntoView ??= function () {}
})

function stubClipboard(clip: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true })
}

/** `navigator.permissions` answering `clipboard-read` with `state`; null removes the API. */
function stubPermission(state: PermissionState | null) {
  const permissions = state === null ? undefined : { query: vi.fn(async () => ({ state }) as PermissionStatus) }
  Object.defineProperty(navigator, 'permissions', { value: permissions, configurable: true })
}

function setup(clip: Partial<Clipboard> | undefined = { readText: async () => '' }, permission: PermissionState | null = 'granted') {
  const user = userEvent.setup()
  // After userEvent.setup(), which installs its own clipboard stub.
  stubClipboard(clip)
  stubPermission(permission)
  render(
    <CommandPalette
      onOpenTarget={(t, o) => useTabs.getState().open(t, o)}
      onToggleSidebar={vi.fn()}
      onToggleRightPanel={vi.fn()}
      onShowRightPanel={vi.fn()}
    />,
  )
  return user
}

// Content and actions are one list: open the palette and type to reach an action. `q` empty shows
// the clipboard offers. (`show('actions')` opens the same list; it has no key.)
async function openActions(user: ReturnType<typeof userEvent.setup>, q = '') {
  act(() => usePalette.getState().show('actions'))
  const input = await screen.findByPlaceholderText(PALETTE_TEXT.placeholder)
  if (q) await user.type(input, q)
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  usePalette.setState({ open: false, mode: 'search' })
  usePeek.getState().close()
  useTabs.getState().reset()
  useRecent.setState({ paths: [] })
  useLinkIndex.setState({ types: [PAGE], objects: [], loaded: true })
  resetSettingsModal()
})

afterEach(() => {
  setFocusToggleForTests(undefined)
  vi.unstubAllGlobals()
})

describe('action palette, M8 actions', () => {
  test('the open space label', () => {
    expect(ACTION_TEXT.openSpace('Work')).toBe('Open space "Work"')
  })

  test('open space lists other spaces and switches', async () => {
    mocked.spaces.mockResolvedValue([
      spaceEntry({ path: '/spaces/Home', name: 'Home', current: true }),
      spaceEntry({ path: '/spaces/Work', name: 'Work' }),
      spaceEntry({ path: '/spaces/Gone', name: 'Gone', missing: true }),
    ])
    const user = setup()
    await openActions(user, 'open space')
    const row = await screen.findByText('Open space "Work"')
    expect(screen.queryByText('Open space "Home"')).toBeNull()
    expect(screen.queryByText('Open space "Gone"')).toBeNull()
    await user.click(row)
    expect(usePalette.getState().open).toBe(false)
    expect(switchSpace).toHaveBeenCalledWith('/spaces/Work')
  })

  test('open settings and toggle focus mode run', async () => {
    const toggle = vi.fn()
    setFocusToggleForTests(toggle)
    const user = setup()
    await openActions(user, 'settings')
    await user.click(screen.getByText(ACTION_TEXT.openSettings))
    expect(useSettingsModal.getState().isOpen).toBe(true)

    useSettingsModal.getState().close()
    await openActions(user, 'focus')
    await user.click(screen.getByText(ACTION_TEXT.toggleFocusMode))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  test('toggle focus mode is left out while focus mode is not built', async () => {
    setFocusToggleForTests(null)
    const user = setup()
    await openActions(user, 'focus')
    expect(screen.queryByText(ACTION_TEXT.toggleFocusMode)).toBeNull()
  })

  test('open extended search opens an empty search page', async () => {
    const user = setup()
    await openActions(user, 'extended')
    await user.click(screen.getByText(ACTION_TEXT.openEmptyLocalSpaceQuery))
    expect(currentTarget(useTabs.getState())).toMatchObject({ kind: 'search' })
  })
})

describe('action palette, clipboard group', () => {
  test('text in the clipboard offers the daily note and new page with a block count', async () => {
    const user = setup({ readText: async () => 'one\n\ntwo' })
    await openActions(user)
    const row = await screen.findByText(PASTE_TEXT.addToDailyNote)
    expect(row.closest('[data-action]')?.textContent).toContain('2 blocks')
    expect(screen.getByText(PASTE_TEXT.createPageWithBlocks)).toBeTruthy()
    await user.click(row)
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalled())
    expect(mocked.createDailyNote).toHaveBeenCalled()
    expect(mocked.saveBody.mock.calls[0][1]).toBe('one\n\ntwo\n')
  })

  test('pasted url creates a page without fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const user = setup({ readText: async () => 'https://example.com/docs' })
    await openActions(user)
    await waitFor(() => expect(document.querySelector('[data-action="paste:url"]')?.textContent).toBe('Create Page'))
    await user.click(document.querySelector<HTMLElement>('[data-action="paste:url"]')!)
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalled())
    expect(mocked.createObject).toHaveBeenCalledWith('page', { title: 'example.com/docs', templateId: 'none' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test.each(['prompt', 'denied', null] as const)(
    'clipboard-read %s: opening does not read; a Clipboard row reads it when picked',
    async (permission) => {
      const readText = vi.fn(async () => 'one\n\ntwo')
      const user = setup({ readText }, permission)
      await openActions(user)
      const row = await screen.findByText(PASTE_TEXT.readClipboard)
      expect(readText).not.toHaveBeenCalled()
      expect(screen.queryByText(PASTE_TEXT.denied)).toBeNull()
      await user.click(row)
      expect(await screen.findByText(PASTE_TEXT.addToDailyNote)).toBeTruthy()
      expect(readText).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(PASTE_TEXT.readClipboard)).toBeNull()
    },
  )

  test('an empty-query open never shows the denied line; a refused read the user asked for does', async () => {
    const refuse = {
      read: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      readText: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
    }
    // Granted, but the read fails anyway: no denied line on open, the row offers a retry.
    const user = setup(refuse, 'granted')
    await openActions(user)
    const row = await screen.findByText(PASTE_TEXT.readClipboard)
    expect(screen.queryByText(PASTE_TEXT.denied)).toBeNull()
    await user.click(row)
    expect(await screen.findByText(PASTE_TEXT.denied)).toBeTruthy()
    expect(screen.queryByText(PASTE_TEXT.addToDailyNote)).toBeNull()
    expect(screen.queryByText(PASTE_TEXT.upload)).toBeNull()
    expect(document.querySelector('[data-paste-group]')).toBeNull()
  })
})
