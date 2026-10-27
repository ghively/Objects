import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { useTabs, type Target } from '@/nav/tabs'
import { TabStrip } from './TabStrip'

const typeT = (typeId: string): Target => ({ kind: 'type', typeId })
const s = useTabs.getState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
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
    expect(tab).toHaveAttribute('title', 'Double click to make tab persistent.')
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin tab' }))
    expect(tabs()[0]).toHaveTextContent('b')
    expect(tabs()[0]).toHaveAttribute('data-pinned')
    expect(within(tabs()[0]).queryByRole('button', { name: 'Close tab' })).toBeNull()
    // Middle click does not close a pinned tab.
    fireEvent(tabs()[0], new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(s().tabs).toHaveLength(2)

    fireEvent.contextMenu(tabs()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin tab' }))
    expect(s().tabs[0].pinned).toBe(false)
    expect(within(tabs()[0]).getByRole('button', { name: 'Close tab' })).toBeInTheDocument()

    // "Close tab" in the context menu closes it.
    fireEvent.contextMenu(tabs()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }))
    expect(s().tabs).toHaveLength(1)
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
