// M31 item 6: the Explore side panel (catalog section 7): tabs "Explore" (cards AI Chat and Search)
// and "Relevant Content" (objects related to the page you are on) with "Find More".
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAiStore } from '@/ai/store'
import { resetLinkIndex } from '@/links/linkIndex'
import { BACKLINKS_TARGET, openEntryIn } from '@/nav/sidepanel'
import { activeTab, useTabs, type SidepanelTarget, type Target } from '@/nav/tabs'
import { usePalette } from '@/palette/usePalette'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, references } from '@/test/mockApi'
import { SidePanel } from './SidePanel'
import type { RenderSidepanelTarget } from './SidePanelArea'
import { EXPLORE_TEXT } from './ExplorePanel'

const mocked = vi.mocked(api)
const obj = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState
const tab = () => activeTab(s())!
const renderTarget: RenderSidepanelTarget = (t: SidepanelTarget) => <p>page {t.kind}</p>
const area = (n: number) => screen.getByRole('region', { name: `Side panel area ${n}` })
const entryTarget = () => openEntryIn(tab().sidepanel ?? [], 'area1')?.target

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  s().reset()
  resetAiStore()
  resetLinkIndex()
  usePalette.getState().hide()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
  mocked.references.mockImplementation(async (path: string) =>
    references({
      related: [
        { path: 'Pages/Near.md', score: 3 },
        { path: 'Pages/Far.md', score: 1 },
      ],
      summaries: {
        'Pages/Near.md': objectSummary({ path: 'Pages/Near.md', title: `Near ${path}` }),
        'Pages/Far.md': objectSummary({ path: 'Pages/Far.md', title: 'Far away' }),
      },
    }),
  )
})

describe('Explore side panel (M31)', () => {
  test('test explore panel has the Explore and Relevant Content tabs, Explore first', () => {
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    const tabs = within(area(1)).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Explore', 'Relevant Content'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  test('test explore tab shows the AI Chat and Search cards; Search opens search in the entry', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    const cards = within(area(1)).getAllByTestId('explore-card')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([EXPLORE_TEXT.aiChat, EXPLORE_TEXT.search])
    await user.click(within(area(1)).getByRole('button', { name: 'Search' }))
    expect(entryTarget()).toEqual({ kind: 'search' })
    expect(within(area(1)).getByText('page search')).toBeInTheDocument()
  })

  test('test explore AI Chat card opens the chat in the entry', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    await user.click(within(area(1)).getByRole('button', { name: 'AI Chat' }))
    expect(entryTarget()).toEqual({ kind: 'aiChat' })
  })

  test('test explore with Hide AI features: no AI Chat card, Search stays', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    expect(within(area(1)).getAllByTestId('explore-card').map((c) => c.getAttribute('aria-label'))).toEqual([EXPLORE_TEXT.search])
    expect(within(area(1)).queryByRole('button', { name: 'AI Chat' })).toBeNull()
  })

  test('test explore keeps Graph View and Backlinks reachable', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    await user.click(within(area(1)).getByRole('button', { name: 'Backlinks' }))
    expect(entryTarget()).toEqual(BACKLINKS_TARGET)
    s().newSidepanelEntry('area1')
    await user.click(await within(area(1)).findByRole('button', { name: 'Graph View' }))
    expect(entryTarget()).toEqual({ kind: 'localGraph' })
  })

  test('test relevant content lists the objects related to the open page', async () => {
    const user = userEvent.setup()
    s().open(obj('Pages/Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    await user.click(within(area(1)).getByRole('tab', { name: 'Relevant Content' }))
    expect(await within(area(1)).findByText('Near Pages/Main.md')).toBeInTheDocument()
    expect(within(area(1)).getByText('Far away')).toBeInTheDocument()
    expect(mocked.references).toHaveBeenCalledWith('Pages/Main.md', expect.anything())
  })

  test('test relevant content Find More opens search', async () => {
    const user = userEvent.setup()
    s().open(obj('Pages/Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    await user.click(within(area(1)).getByRole('tab', { name: 'Relevant Content' }))
    await user.click(within(area(1)).getByRole('button', { name: 'Find More' }))
    expect(usePalette.getState()).toMatchObject({ open: true, mode: 'search' })
  })

  test('test relevant content without an open page says so', async () => {
    const user = userEvent.setup()
    s().open({ kind: 'trash' })
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    await user.click(within(area(1)).getByRole('tab', { name: 'Relevant Content' }))
    expect(within(area(1)).getByText('Open a page to see content related to it.')).toBeInTheDocument()
    await waitFor(() => expect(mocked.references).not.toHaveBeenCalled())
  })

  test('test toggling the side panel with nothing in it shows Explore', () => {
    s().open(obj('Main.md'))
    s().toggleSidepanel()
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    expect(within(area(1)).getByRole('tab', { name: 'Explore' })).toHaveAttribute('aria-selected', 'true')
  })
})
