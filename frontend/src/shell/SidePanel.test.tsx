import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { openEntryIn } from '@/nav/sidepanel'
import { activeTab, currentTarget, useTabs, type SidepanelTarget, type Target } from '@/nav/tabs'
import { SidePanel } from './SidePanel'
import type { RenderSidepanelTarget } from './SidePanelArea'

const obj = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState
const tab = () => activeTab(s())!
const entryIn = (area: 'area1' | 'area2' | 'area3') => openEntryIn(tab().sidepanel ?? [], area)

// Each page shows its target and, for objects, a resolved wikilink chip to "Linked.md".
const renderTarget: RenderSidepanelTarget = (t: SidepanelTarget) =>
  t.kind === 'object' ? (
    <div>
      <p>page {t.path}</p>
      <span className="wikilink" data-resolved-path="Linked.md" onClick={() => s().open(obj('Peeked.md'))}>
        a link
      </span>
    </div>
  ) : (
    <p>page {t.kind}</p>
  )

function panel() {
  return screen.getByRole('complementary', { name: 'Side panel' })
}

function area(n: number) {
  return screen.getByRole('region', { name: `Side panel area ${n}` })
}

function pointer(el: Element, type: string, x: number, y: number) {
  fireEvent(el, new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }))
}

beforeEach(() => {
  localStorage.clear()
  s().reset()
  resetLinkIndex()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SidePanel', () => {
  test('test nothing renders while the tab has no open entry', () => {
    s().open(obj('Main.md'))
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
  })

  test('test areas stack, resize and persist per tab', () => {
    // The card (main column plus panel) is 1000 px wide; the panel 1000 px high.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 1000, width: 1000 } as DOMRect)
    s().open(obj('One.md'))
    s().openInSidepanel(obj('A1.md'))
    s().openInSidepanel(obj('A2.md'), { area: 'area2' })
    s().openInSidepanel(obj('A3.md'), { area: 'area3' })
    render(
      <div>
        <SidePanel space={null} renderTarget={renderTarget} />
      </div>,
    )

    // Stacked top to bottom: area 1, area 2, area 3.
    const regions = within(panel()).getAllByRole('region')
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual(['Side panel area 1', 'Side panel area 2', 'Side panel area 3'])
    expect(within(area(2)).getByText('page A2.md')).toBeInTheDocument()
    // Object: 45 % of the main column plus the panel; areas 2 and 3 are 220 px, area 1 the rest (120 px at least).
    expect(panel().style.width).toBe('45%')
    expect(panel().className).toContain('shrink-0')
    expect(screen.getByTestId('sidepanel-area2').style.flex).toBe('0 0 220px')
    expect(screen.getByTestId('sidepanel-area3').style.flex).toBe('0 0 220px')
    expect(screen.getByTestId('sidepanel-area1').style.minHeight).toBe('120px')

    // Width: drag the left edge 100 px (10 % of 1000) to the left; written on pointer up.
    const edge = screen.getByRole('separator', { name: 'Resize side panel' })
    pointer(edge, 'pointerdown', 1000, 0)
    pointer(edge, 'pointermove', 950, 0)
    expect(panel().style.width).toBe('50%')
    expect(tab().sidepanelLayout?.width).toBeUndefined()
    pointer(edge, 'pointermove', 900, 0)
    pointer(edge, 'pointerup', 900, 0)
    expect(tab().sidepanelLayout?.width).toBeCloseTo(0.55)
    expect(panel().style.width).toBe('55%')
    // Never past 90 %, never under 10 %.
    pointer(edge, 'pointerdown', 1000, 0)
    pointer(edge, 'pointerup', 0, 0)
    expect(tab().sidepanelLayout?.width).toBe(0.9)
    pointer(edge, 'pointerdown', 0, 0)
    pointer(edge, 'pointerup', 2000, 0)
    expect(tab().sidepanelLayout?.width).toBe(0.1)
    // A double click goes back to 45 %.
    fireEvent.doubleClick(edge)
    expect(tab().sidepanelLayout?.width).toBe(0.45)
    expect(panel().style.width).toBe('45%')

    // Area 2's height: dragging its top edge down 100 px takes it from 220 to 120 px, and no lower.
    const bar = screen.getByRole('separator', { name: 'Resize side panel area 2' })
    pointer(bar, 'pointerdown', 0, 400)
    pointer(bar, 'pointerup', 0, 500)
    expect(tab().sidepanelLayout?.area2Size).toBe(120)
    pointer(bar, 'pointerdown', 0, 400)
    pointer(bar, 'pointerup', 0, 500)
    expect(tab().sidepanelLayout?.area2Size).toBe(120)
    // Dragged up, area 1 keeps its 120 px: 1000 - 120 - area 3's 220.
    pointer(bar, 'pointerdown', 0, 400)
    pointer(bar, 'pointerup', 0, -800)
    expect(tab().sidepanelLayout?.area2Size).toBe(660)

    // Another tab has its own panel (none yet); switching back shows this one's layout again.
    const first = tab().id
    act(() => s().setSidepanelLayout({ width: 0.3 }))
    act(() => s().open(obj('Two.md'), { newTab: true }))
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
    act(() => s().openInSidepanel(obj('B1.md')))
    expect(within(panel()).getAllByRole('region')).toHaveLength(1)
    expect(panel().style.width).toBe('45%')
    act(() => s().activate(first))
    expect(within(panel()).getAllByRole('region')).toHaveLength(3)
    expect(panel().style.width).toBe('30%')
  })

  test('test new sidepanel tab shows the Explore empty state', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('A.md'))
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    await user.click(within(area(1)).getByRole('button', { name: 'New Sidepanel Tab' }))
    expect(within(area(1)).getByText('Explore')).toBeInTheDocument()
    expect(
      within(area(1)).getByText('Open relevant content or view the graph view to expand the context of your work.'),
    ).toBeInTheDocument()
    expect(within(area(1)).queryByText('page A.md')).toBeNull()
    expect(tab().sidepanel).toHaveLength(2)
    // The empty state opens the graph view in this entry.
    await user.click(within(area(1)).getByRole('button', { name: 'Graph View' }))
    expect(within(area(1)).getByText('page localGraph')).toBeInTheDocument()
  })

  test('test entry header actions: browse, open as page, move area, close', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('A.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)

    // Browse sidepanel tabs: the area's entries; picking one makes it the open one.
    await user.click(within(area(1)).getByRole('button', { name: 'Browse sidepanel tabs' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['A', 'New tab'])
    await user.click(items[0])
    expect(within(area(1)).getByText('page A.md')).toBeInTheDocument()

    // Open sidepanel menu: move to area 2.
    await user.click(within(area(1)).getByRole('button', { name: 'Open sidepanel menu' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Move to area 1', 'Move to area 2', 'Move to area 3', 'Close'])
    expect(screen.getByRole('menuitem', { name: 'Move to area 1' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Move to area 2' }))
    expect(within(area(2)).getByText('page A.md')).toBeInTheDocument()
    expect(within(area(1)).getByText('Explore')).toBeInTheDocument()

    // Open as page: the main view shows it and the entry closes.
    await user.click(within(area(2)).getByRole('button', { name: 'Open as page' }))
    expect(currentTarget(s())).toEqual(obj('A.md'))
    expect(screen.queryByRole('region', { name: 'Side panel area 2' })).toBeNull()

    // Close: the last entry goes, and the panel with it.
    expect(within(area(1)).getByRole('button', { name: 'Open as page' })).toBeDisabled()
    expect(within(area(1)).getByRole('button', { name: 'Swap' })).toBeDisabled()
    await user.click(within(area(1)).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
  })

  test('test swap exchanges side panel entry and main target', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('Side.md'))
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    const swap = within(area(1)).getByRole('button', { name: 'Swap' })
    expect(swap).toHaveAttribute('title', 'Drag onto the main content to swap.')
    await user.click(swap)
    expect(currentTarget(s())).toEqual(obj('Side.md'))
    expect(within(area(1)).getByText('page Main.md')).toBeInTheDocument()
  })

  test('test links inside an entry navigate the entry with its own back and forward', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('A.md'))
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    const back = within(area(1)).getByRole('button', { name: 'Back' })
    const forward = within(area(1)).getByRole('button', { name: 'Forward' })
    expect(back).toBeDisabled()

    await user.click(within(area(1)).getByText('a link'))
    expect(within(area(1)).getByText('page Linked.md')).toBeInTheDocument()
    // The link's own handler (which would open in the main view) did not run.
    expect(currentTarget(s())).toEqual(obj('Main.md'))
    expect(back).toBeEnabled()
    expect(forward).toBeDisabled()

    await user.click(back)
    expect(within(area(1)).getByText('page A.md')).toBeInTheDocument()
    expect(forward).toBeEnabled()
    await user.click(forward)
    expect(within(area(1)).getByText('page Linked.md')).toBeInTheDocument()
    expect(entryIn('area1')!.history).toEqual([obj('A.md'), obj('Linked.md')])

    // Ctrl-click keeps the link's own behaviour.
    await user.keyboard('{Control>}')
    await user.click(within(area(1)).getByText('a link'))
    await user.keyboard('{/Control}')
    expect(currentTarget(s())).toEqual(obj('Peeked.md'))
  })

  test('test double click on the entry title toggles persistent', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('A.md'))
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    const title = within(area(1)).getByTestId('sidepanel-entry-title')
    expect(title).toHaveClass('italic')
    expect(title).toHaveAttribute('title', 'Double click to make tab persistent.')
    await user.dblClick(title)
    expect(entryIn('area1')!.isPersistent).toBe(true)
    expect(within(area(1)).getByTestId('sidepanel-entry-title')).not.toHaveClass('italic')
    // A persistent entry keeps its page: new content gets an entry beside it.
    act(() => s().openInSidepanel(obj('B.md')))
    expect(tab().sidepanel).toHaveLength(2)
  })
})
