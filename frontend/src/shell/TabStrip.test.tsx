import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs, type Target } from '@/nav/tabs'
import { typeDef } from '@/test/mockApi'
import { resetPinned } from './usePinned'
import { TabStrip } from './TabStrip'

const typeT = (typeId: string): Target => ({ kind: 'type', typeId })
const s = useTabs.getState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
  resetPinned()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function tabs() {
  return within(screen.getByRole('tablist', { name: 'Tabs' })).getAllByRole('tab')
}

describe('TabStrip', () => {
  test('test double click toggles persistent and italic', () => {
    s().open(typeT('task'))
    render(<TabStrip space={null} />)
    const tab = tabs()[0]
    expect(tab).toHaveClass('italic')
    expect(tab).toHaveAttribute('title', 'Double-click to keep this tab open.')
    fireEvent.doubleClick(tab)
    expect(s().tabs[0].persistent).toBe(true)
    expect(tabs()[0]).not.toHaveClass('italic')
    expect(tabs()[0]).not.toHaveAttribute('title')
    fireEvent.doubleClick(tabs()[0])
    expect(s().tabs[0].persistent).toBe(false)
    expect(tabs()[0]).toHaveClass('italic')
  })

  test('test pinned tabs sort first and have no close button', () => {
    s().open(typeT('a'))
    s().open(typeT('b'), { newTab: true })
    render(<TabStrip space={null} />)
    expect(within(tabs()[1]).getByRole('button', { name: 'Close tab' })).toBeInTheDocument()

    fireEvent.contextMenu(tabs()[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Tab' }))
    expect(tabs()[0]).toHaveTextContent('b')
    expect(tabs()[0]).toHaveAttribute('data-pinned')
    expect(within(tabs()[0]).queryByRole('button', { name: 'Close tab' })).toBeNull()
    // Middle click does not close a pinned tab.
    fireEvent(tabs()[0], new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(s().tabs).toHaveLength(2)
    // Nor does the context menu: it has no "Close tab" for a pinned tab (on every path).
    fireEvent.contextMenu(tabs()[0])
    expect(screen.getByRole('menuitem', { name: 'Unpin Tab' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Close tab' })).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    fireEvent.contextMenu(tabs()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Tab' }))
    expect(s().tabs[0].pinned).toBe(false)
    expect(within(tabs()[0]).getByRole('button', { name: 'Close tab' })).toBeInTheDocument()

    // "Close tab" in the context menu closes it.
    fireEvent.contextMenu(tabs()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }))
    expect(s().tabs).toHaveLength(1)
  })

  test("a type tab's menu: Pin to sidebar, Pin Tab, Object Type Settings, Import (Ctrl I), Close tab", async () => {
    const PAGES = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
    vi.mocked(api).ui.mockResolvedValue({ ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'u0' })
    vi.mocked(api).onChange.mockReturnValue(() => undefined)
    vi.mocked(api).patchUi.mockImplementation(async (patch) => ({ ui: { pinned: [], sections: [], allNotesLayout: 'list', ...patch }, revision: 'u1' }))
    useLinkIndex.setState({ types: [PAGES], objects: [], loaded: true })
    s().open(typeT('page'))
    render(<TabStrip space={null} />)
    fireEvent.contextMenu(tabs()[0])
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Pin to sidebar', 'Pin Tab', 'Object Type Settings', 'ImportCtrl I', 'Close tab'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() => expect(vi.mocked(api).patchUi).toHaveBeenCalledWith({ pinned: [{ kind: 'type', id: 'page' }] }, expect.anything()))
    fireEvent.contextMenu(tabs()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Object Type Settings' }))
    expect(currentTarget(s())).toEqual({ kind: 'typeSettings', typeId: 'page' })
  })

  test('a non-type tab keeps the plain menu', () => {
    s().open({ kind: 'calendar' })
    render(<TabStrip space={null} />)
    fireEvent.contextMenu(tabs()[0])
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Pin Tab', 'Close tab'])
  })

  test('test tabs are 60 to 200 px wide with a 5 px gap', () => {
    s().open(typeT('a'))
    render(<TabStrip space={null} />)
    expect(tabs()[0].className).toContain('max-w-[200px]')
    expect(tabs()[0].className).toContain('min-w-[60px]')
    expect(screen.getByRole('tablist', { name: 'Tabs' }).className).toContain('gap-[5px]')
  })

  test('test scroll buttons appear on overflow', () => {
    s().open(typeT('a'))
    const widths = { scroll: 100, client: 100 }
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => widths.scroll)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths.client)
    render(<TabStrip space={null} />)
    expect(screen.queryByRole('button', { name: 'Scroll tab list left' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Scroll tab list right' })).toBeNull()

    widths.scroll = 900
    act(() => {
      s().open(typeT('b'), { newTab: true })
    })
    expect(screen.getByRole('button', { name: 'Scroll tab list left' })).toBeInTheDocument()
    const right = screen.getByRole('button', { name: 'Scroll tab list right' })
    const list = screen.getByRole('tablist', { name: 'Tabs' })
    const before = list.scrollLeft
    fireEvent.click(right)
    expect(list.scrollLeft).toBeGreaterThan(before)
  })

  test('the tab menu button is in the strip', () => {
    render(<TabStrip space={null} />)
    expect(screen.getByRole('button', { name: 'Tab menu' })).toBeInTheDocument()
  })
})
