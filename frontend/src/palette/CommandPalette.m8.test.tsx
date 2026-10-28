import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { objectSummary, searchResult, typeDef } from '@/test/mockApi'
import { CommandPalette } from './CommandPalette'
import { PALETTE_TEXT } from './searchOptions'
import { OPEN_IN_EXTENDED_SEARCH } from './SearchView'
import { usePalette } from './usePalette'

const mocked = vi.mocked(api)
const STRINGS_FILE = '../../../reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js'
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const ALPHA = objectSummary({ path: 'Pages/Alpha.md', title: 'Alpha' })

beforeAll(() => {
  Element.prototype.scrollIntoView ??= function () {}
})

function setup() {
  const user = userEvent.setup()
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

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}')
  return screen.findByPlaceholderText(PALETTE_TEXT.placeholderSearch)
}

beforeEach(() => {
  mocked.search.mockReset()
  mocked.search.mockResolvedValue({ results: [searchResult({ path: 'Pages/Alpha.md', title: 'Alpha' })], partial: false })
  usePalette.setState({ open: false, mode: 'search' })
  usePeek.getState().close()
  useTabs.getState().reset()
  useRecent.setState({ paths: [] })
  useLinkIndex.setState({ types: [PAGE], objects: [ALPHA], loaded: true })
})

describe('extended search from the palette (M8)', () => {
  test('the row label is the reference string', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, STRINGS_FILE), 'utf8')
    expect(src).toContain('LocalSpaceQuery:{t:0,b:{t:2,i:[{t:3}],s:`' + OPEN_IN_EXTENDED_SEARCH + '`}}')
  })

  test('palette opens extended search with the query', async () => {
    const user = setup()
    const input = await openSearch(user)
    expect(screen.queryByText(OPEN_IN_EXTENDED_SEARCH)).toBeNull()
    await user.type(input, 'alpha')
    await screen.findByText('Alpha')
    await user.click(screen.getByText(OPEN_IN_EXTENDED_SEARCH))
    expect(usePalette.getState().open).toBe(false)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'search', q: 'alpha', textOnly: undefined })
  })

  test('ctrl+shift+enter opens extended search; shift+enter still opens the side panel', async () => {
    const user = setup()
    let input = await openSearch(user)
    await user.type(input, 'alpha')
    await screen.findByText('Alpha')
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    expect(usePalette.getState().open).toBe(false)
    expect(currentTarget(useTabs.getState())).toMatchObject({ kind: 'search', q: 'alpha' })
    expect(useTabs.getState().tabs).toHaveLength(1)

    input = await openSearch(user)
    await user.type(input, 'alpha')
    await screen.findByText('Alpha')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)!
    expect(tab.sidepanel?.find((e) => e.isOpen)?.target).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
  })
})
