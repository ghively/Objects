import { render, screen, waitFor } from '@testing-library/react'
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
const STRINGS_FILE = '../../../reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js'
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })

beforeAll(() => {
  Element.prototype.scrollIntoView ??= function () {}
})

function stubClipboard(clip: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true })
}

function setup(clip: Partial<Clipboard> | undefined = { readText: async () => '' }) {
  const user = userEvent.setup()
  // After userEvent.setup(), which installs its own clipboard stub.
  stubClipboard(clip)
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

async function openActions(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}p{/Control}')
  return screen.findByPlaceholderText(PALETTE_TEXT.placeholderActions)
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
  test('action labels match the reference', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, STRINGS_FILE), 'utf8')
    expect(src).toContain('openEmptyLocalSpaceQuery:{t:0,b:{t:2,i:[{t:3}],s:`' + ACTION_TEXT.openEmptyLocalSpaceQuery + '`}}')
    expect(src).toContain('openSettings:{t:0,b:{t:2,i:[{t:3}],s:`' + ACTION_TEXT.openSettings + '`}}')
    expect(src).toContain('toggleFocusMode:{t:0,b:{t:2,i:[{t:3}],s:`' + ACTION_TEXT.toggleFocusMode + '`}}')
    expect(src).toContain('openSpace:{t:0,b:{t:2,i:[{t:3,v:`Open space "`},{t:4,k:`spaceName`},{t:3,v:`"`}]}}')
    expect(ACTION_TEXT.openSpace('Work')).toBe('Open space "Work"')
  })

  test('open space lists other spaces and switches', async () => {
    mocked.spaces.mockResolvedValue([
      spaceEntry({ path: '/spaces/Home', name: 'Home', current: true }),
      spaceEntry({ path: '/spaces/Work', name: 'Work' }),
      spaceEntry({ path: '/spaces/Gone', name: 'Gone', missing: true }),
    ])
    const user = setup()
    await openActions(user)
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
    await openActions(user)
    await user.click(screen.getByText(ACTION_TEXT.openSettings))
    expect(useSettingsModal.getState().isOpen).toBe(true)

    useSettingsModal.getState().close()
    await openActions(user)
    await user.click(screen.getByText(ACTION_TEXT.toggleFocusMode))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  test('toggle focus mode is left out while focus mode is not built', async () => {
    setFocusToggleForTests(null)
    const user = setup()
    await openActions(user)
    expect(screen.queryByText(ACTION_TEXT.toggleFocusMode)).toBeNull()
  })

  test('open extended search opens an empty search page', async () => {
    const user = setup()
    await openActions(user)
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

  test('clipboard denied offers nothing', async () => {
    const user = setup({
      read: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      readText: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
    })
    await openActions(user)
    expect(await screen.findByText(PASTE_TEXT.denied)).toBeTruthy()
    expect(screen.queryByText(PASTE_TEXT.addToDailyNote)).toBeNull()
    expect(screen.queryByText(PASTE_TEXT.upload)).toBeNull()
    expect(document.querySelector('[data-paste-group]')).toBeNull()
  })
})
