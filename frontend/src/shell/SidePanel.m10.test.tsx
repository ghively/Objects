// M10: the AI chat in the side panel: the Explore card, the entry, the reveal hook and the open key.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { AiHost } from '@/ai/AiHost'
import { noticeKey } from '@/ai/reveal'
import { openAiChat, resetAiStore } from '@/ai/store'
import { resetLinkIndex } from '@/links/linkIndex'
import { isAiChatTarget, openEntryIn } from '@/nav/sidepanel'
import { activeTab, useTabs, type SidepanelTarget, type Target } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { SidePanel } from './SidePanel'
import type { RenderSidepanelTarget } from './SidePanelArea'

const mocked = vi.mocked(api)
const obj = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState
const tab = () => activeTab(s())!
const renderTarget: RenderSidepanelTarget = (t: SidepanelTarget) => <p>page {t.kind}</p>
const area = (n: number) => screen.getByRole('region', { name: `Side panel area ${n}` })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem(noticeKey(null), '1')
  localStorage.setItem(noticeKey('/space'), '1')
  s().reset()
  resetAiStore()
  resetLinkIndex()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
})

describe('SidePanel (M10)', () => {
  test('test Explore shows the AI Chat card first and it opens the chat in the entry', async () => {
    const user = userEvent.setup()
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    const buttons = within(area(1))
      .getAllByRole('button')
      // M31: the AI Chat card's name is its label (its help text is the description).
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
      .filter((t) => t === 'AI Chat' || t === 'Graph View' || t === 'Backlinks')
    expect(buttons).toEqual(['AI Chat', 'Graph View', 'Backlinks'])
    await user.click(within(area(1)).getByRole('button', { name: 'AI Chat' }))
    expect(openEntryIn(tab().sidepanel!, 'area1')?.target).toEqual({ kind: 'aiChat' })
    expect(within(area(1)).getByTestId('sidepanel-entry-title').textContent).toBe('AI Chat')
    expect(await within(area(1)).findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    // Not a page: no swap, no open as page.
    expect(within(area(1)).getByRole('button', { name: 'Swap' })).toBeDisabled()
    expect(within(area(1)).getByRole('button', { name: 'Open as page' })).toBeDisabled()
  })

  test('test hidden AI features: no card, and an open chat closes', async () => {
    s().open(obj('Main.md'))
    s().newSidepanelEntry('area1')
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    const view = render(<SidePanel space={null} renderTarget={renderTarget} />)
    expect(within(area(1)).queryByRole('button', { name: 'AI Chat' })).toBeNull()
    expect(within(area(1)).getByRole('button', { name: 'Graph View' })).toBeInTheDocument()
    view.unmount()

    act(() => useSettings.setState({ settings: settingsDefaults }))
    s().openInSidepanel({ kind: 'aiChat' })
    render(<SidePanel space={null} renderTarget={renderTarget} />)
    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    act(() => useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } }))
    await waitFor(() => expect((tab().sidepanel ?? []).some((e) => isAiChatTarget(e.target))).toBe(false))
  })

  test('test openAiChat reveals the chat and runs the seed; the open key reveals it', async () => {
    const user = userEvent.setup()
    s().open(obj('Pages/Main.md'))
    render(
      <>
        <AiHost />
        <SidePanel space={null} renderTarget={renderTarget} />
      </>,
    )
    act(() => openAiChat({ mode: 'askBlock', prompt: 'What is this?', block: 'A block' }))
    expect((tab().sidepanel ?? []).filter((e) => isAiChatTarget(e.target))).toHaveLength(1)
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ mode: 'askBlock', prompt: 'What is this?', block: 'A block', contextPaths: ['Pages/Main.md'] })

    // Hidden panel: the open key (Ctrl+Alt+J) shows it again, the same entry.
    act(() => s().toggleSidepanel())
    expect(tab().hideSidepanel).toBe(true)
    await user.keyboard('{Control>}{Alt>}j{/Alt}{/Control}')
    expect(tab().hideSidepanel).toBe(false)
    expect((tab().sidepanel ?? []).filter((e) => isAiChatTarget(e.target))).toHaveLength(1)

    // Hidden AI features: neither the key nor openAiChat does anything.
    act(() => useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } }))
    await waitFor(() => expect((tab().sidepanel ?? []).some((e) => isAiChatTarget(e.target))).toBe(false))
    await user.keyboard('{Control>}{Alt>}j{/Alt}{/Control}')
    act(() => openAiChat({ mode: 'chat', prompt: 'x' }))
    expect((tab().sidepanel ?? []).some((e) => isAiChatTarget(e.target))).toBe(false)
  })
})
