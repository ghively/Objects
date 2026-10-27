import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { BACKLINKS_TARGET, isBacklinksTarget, openEntryIn, openInArea, sameSidepanelTarget } from '@/nav/sidepanel'
import { activeTab, currentTarget, useTabs, type SidepanelTarget, type Target } from '@/nav/tabs'
import { objectSummary, references } from '@/test/mockApi'
import { MainPanel } from './MainPanel'
import { SidePanel } from './SidePanel'
import { SIDEPANEL_ENTRY_MIME, type RenderSidepanelTarget } from './SidePanelArea'

const mocked = vi.mocked(api)
const obj = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState
const tab = () => activeTab(s())!
const entryIn = (area: 'area1' | 'area2' | 'area3') => openEntryIn(tab().sidepanel ?? [], area)

const renderTarget: RenderSidepanelTarget = (t: SidepanelTarget) =>
  t.kind === 'object' ? <p>page {t.path}</p> : <p>page {t.kind}</p>

function area(n: number) {
  return screen.getByRole('region', { name: `Side panel area ${n}` })
}

beforeEach(() => {
  localStorage.clear()
  s().reset()
  resetLinkIndex()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
  mocked.references.mockReset()
  mocked.references.mockImplementation(async (path: string) =>
    references({
      tabs: ['all', 'backlinks', 'related'],
      backlinks: [{ path: `Pages/Links ${path}`, contexts: [{ context: `About ${path}`, start: 0, end: 5 }], properties: [] }],
      summaries: { [`Pages/Links ${path}`]: objectSummary({ path: `Pages/Links ${path}`, title: `Linker of ${path}` }) },
    }),
  )
})

describe('SidePanel (M8)', () => {
  test('test backlinks side panel entry follows the tab', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    // "Explore" offers Backlinks beside the graph.
    await user.click(within(area(1)).getByRole('button', { name: 'Backlinks' }))
    expect(isBacklinksTarget(entryIn('area1')?.target)).toBe(true)
    expect(within(area(1)).getByTestId('sidepanel-entry-title').textContent).toBe('Backlinks')
    expect(await within(area(1)).findByText('Linker of Main.md')).toBeInTheDocument()
    expect(mocked.references).toHaveBeenLastCalledWith('Main.md', expect.anything())
    // It can't swap or open as a page: it follows the main view.
    expect(within(area(1)).getByRole('button', { name: 'Swap' })).toBeDisabled()

    act(() => s().open(obj('Other.md')))
    expect(await within(area(1)).findByText('Linker of Other.md')).toBeInTheDocument()
    expect(within(area(1)).queryByText('Linker of Main.md')).toBeNull()

    // No object in the main view: not available.
    act(() => s().open({ kind: 'trash' } as Target))
    expect(await within(area(1)).findByText('Backlinks not available')).toBeInTheDocument()
    expect(within(area(1)).getByText('This content type does not support backlinks.')).toBeInTheDocument()
  })

  test('a type without a references section says backlinks are not available', async () => {
    mocked.references.mockImplementation(async () => references({ tabs: [] }))
    s().open(obj('Main.md'))
    s().openInSidepanel(BACKLINKS_TARGET)
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    expect(await within(area(1)).findByText('Backlinks not available')).toBeInTheDocument()
  })

  test('one backlinks entry per tab: opening it again reveals the entry', () => {
    let n = 0
    const id = () => `e${++n}`
    let entries = openInArea([], BACKLINKS_TARGET, 'area1', id)
    entries = openInArea(entries, obj('A.md'), 'area2', id)
    const again = openInArea(entries, BACKLINKS_TARGET, 'area2', id)
    expect(again.filter((e) => isBacklinksTarget(e.target))).toHaveLength(1)
    expect(sameSidepanelTarget(BACKLINKS_TARGET, { kind: 'localGraph' })).toBe(false)
    expect(sameSidepanelTarget(BACKLINKS_TARGET, BACKLINKS_TARGET)).toBe(true)
  })

  test('test dragging an entry onto the main view swaps', async () => {
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('Side.md'))
    render(
      <MainPanel aside={<SidePanel space={null} renderTarget={renderTarget} />}>
        <div data-testid="main-content">main view</div>
      </MainPanel>,
    )
    const title = within(area(1)).getByTestId('sidepanel-entry-title')
    expect(title).toHaveAttribute('draggable', 'true')

    const store = new Map<string, string>()
    const dataTransfer = {
      setData: (k: string, v: string) => store.set(k, v),
      getData: (k: string) => store.get(k) ?? '',
      get types() {
        return [...store.keys()]
      },
      effectAllowed: 'all',
      dropEffect: 'none',
    }
    fireEvent.dragStart(title, { dataTransfer })
    expect(store.get(SIDEPANEL_ENTRY_MIME)).toBe(entryIn('area1')!.id)

    const main = screen.getByTestId('main-content')
    // A drop on the side panel itself does nothing.
    fireEvent.dragOver(area(1), { dataTransfer })
    fireEvent.drop(area(1), { dataTransfer })
    expect(currentTarget(s())).toEqual(obj('Main.md'))

    const over = fireEvent.dragOver(main, { dataTransfer })
    expect(over).toBe(false) // default prevented: the main view takes the drop
    fireEvent.drop(main, { dataTransfer })
    await waitFor(() => expect(currentTarget(s())).toEqual(obj('Side.md')))
    expect(entryIn('area1')?.target).toEqual(obj('Main.md'))
  })

  test('a drag without an entry is left to the main view', () => {
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('Side.md'))
    render(
      <MainPanel aside={<SidePanel space={null} renderTarget={renderTarget} />}>
        <div data-testid="main-content">main view</div>
      </MainPanel>,
    )
    const dataTransfer = { types: ['text/plain'], getData: () => 'x', setData: () => undefined }
    expect(fireEvent.dragOver(screen.getByTestId('main-content'), { dataTransfer })).toBe(true)
    fireEvent.drop(screen.getByTestId('main-content'), { dataTransfer })
    expect(currentTarget(s())).toEqual(obj('Main.md'))
  })
})
