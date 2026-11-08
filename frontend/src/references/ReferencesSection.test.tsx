import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, References } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { objectSummary, propertyDef, references, typeDef } from '@/test/mockApi'
import { ReferencesSection } from './ReferencesSection'
import { referencesKey } from './referencesUi'

const mocked = vi.mocked(api)

const SELF = objectSummary({ path: 'Pages/Self.md', id: 'self-id', title: 'Self' })
const PERSON = typeDef({
  id: 'person',
  name: 'Person',
  propertyDefinitions: [propertyDef({ id: 'p1', key: 'worksWith', name: 'Works with', type: 'entity' })],
})

const summaries = {
  'Pages/Alpha.md': objectSummary({ path: 'Pages/Alpha.md', title: 'Alpha' }),
  'People/Bea.md': objectSummary({ path: 'People/Bea.md', title: 'Bea', type: 'person' }),
  'Pages/Gamma.md': objectSummary({ path: 'Pages/Gamma.md', title: 'Gamma' }),
  'Pages/Delta.md': objectSummary({ path: 'Pages/Delta.md', title: 'Delta' }),
  'Tags/Work.md': objectSummary({ path: 'Tags/Work.md', title: 'work', type: 'tag', color: 'bg-blue' }),
}

const FULL: References = references({
  tabs: ['all', 'backlinks', 'related', 'mentions', 'relatedTags'],
  backlinks: [
    { path: 'Pages/Alpha.md', contexts: [{ context: 'See [[Self]] for more', start: 4, end: 12 }], properties: [] },
    { path: 'People/Bea.md', contexts: [], properties: ['worksWith'] },
  ],
  mentions: [
    {
      path: 'Pages/Gamma.md',
      version: 'vg1',
      occurrences: [{ start: 10, end: 14, text: 'self', context: 'talk about self here', contextStart: 0 }],
    },
  ],
  related: [{ path: 'Pages/Delta.md', score: 3 }],
  relatedTags: [{ name: 'work', path: 'Tags/Work.md', count: 2 }],
  summaries,
})

let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  useLinkIndex.setState({ types: [PERSON, typeDef({ id: 'page', name: 'Page' })], objects: [], loaded: true })
  useTabs.getState().reset()
  usePeek.getState().close()
  listeners = []
  mocked.references.mockReset()
  mocked.references.mockResolvedValue(FULL)
  mocked.linkMention.mockReset()
  mocked.linkMention.mockResolvedValue({ version: 'vg2' })
  mocked.onChange.mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const renderSection = async (summary = SELF) => {
  const utils = render(<ReferencesSection path={summary.path} summary={summary} />)
  await screen.findByRole('tablist', { name: 'References' })
  return utils
}
const tab = (label: RegExp) => screen.getByRole('tab', { name: label })

describe('ReferencesSection', () => {
  test('no section when the object offers no tabs', async () => {
    mocked.references.mockResolvedValue(references({ tabs: [] }))
    const { container } = render(<ReferencesSection path={SELF.path} summary={SELF} />)
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(container).toBeEmptyDOMElement()
  })

  test('tab labels, info tooltips and empty states', async () => {
    mocked.references.mockResolvedValue(
      references({ tabs: ['all', 'backlinks', 'related', 'mentions', 'relatedTags'], summaries }),
    )
    await renderSection()
    const labels = screen.getAllByRole('tab').map((t) => t.querySelector('span')?.textContent)
    expect(labels).toEqual(['All', 'Backlinks', 'Related Content', 'Mentions', 'Related tags'])
    expect(tab(/^Backlinks/).querySelector('[title="Links to this object"]')).not.toBeNull()
    expect(tab(/^Related Content/).querySelector('[title="Similar objects"]')).not.toBeNull()
    expect(tab(/^Mentions/).querySelector('[title="Unlinked name matches"]')).not.toBeNull()
    expect(tab(/^All/)).toHaveAttribute('title', 'Click again to hide')
    expect(tab(/^Backlinks/)).not.toHaveAttribute('title')

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('No backlinks yet')).toBeInTheDocument()
    expect(within(panel).getByText('Backlinks show up here once another page links to this one.')).toBeInTheDocument()
    expect(within(panel).getByText('No related content yet')).toBeInTheDocument()
    expect(within(panel).getByText('Objects that share words with this one will appear here.')).toBeInTheDocument()
    expect(within(panel).getByText('No unlinked mentions')).toBeInTheDocument()
    expect(within(panel).getByText('No related tags')).toBeInTheDocument()
  })

  test('tab counts are shown muted', async () => {
    await renderSection()
    const count = (t: HTMLElement) => t.querySelector('[data-tab-count]')?.textContent
    expect(count(tab(/^Backlinks/))).toBe('2')
    expect(count(tab(/^Mentions/))).toBe('1')
    expect(count(tab(/^All/))).toBe('5')
  })

  test('all stacks tabs in order; clicking the active tab hides and remembers per object', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderSection()
    const parts = [...document.querySelectorAll('[data-all-part]')].map((el) => el.getAttribute('data-all-part'))
    expect(parts).toEqual(['backlinks', 'related', 'mentions', 'relatedTags'])
    const headings = within(screen.getByRole('tabpanel'))
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(headings).toEqual(['Backlinks', 'Related Content', 'Mentions', 'Related tags'])

    await user.click(tab(/^All/))
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(JSON.parse(localStorage.getItem(referencesKey('self-id'))!)).toEqual({ tab: 'all', closed: true })

    await user.click(tab(/^Mentions/))
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tabpanel', 'mentions')
    expect(tab(/^Mentions/)).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText('Gamma')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryByText('Alpha')).toBeNull()
    unmount()

    // Remembered for this object, not for another.
    await renderSection()
    expect(tab(/^Mentions/)).toHaveAttribute('aria-selected', 'true')
    await user.click(tab(/^Mentions/))
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(JSON.parse(localStorage.getItem(referencesKey('self-id'))!)).toEqual({ tab: 'mentions', closed: true })
  })

  test('a saved tab the object no longer offers falls back to the first tab', async () => {
    localStorage.setItem(referencesKey('self-id'), JSON.stringify({ tab: 'relatedTags', closed: false }))
    mocked.references.mockResolvedValue({ ...FULL, tabs: ['all', 'backlinks', 'related', 'mentions'] })
    await renderSection()
    expect(tab(/^All/)).toHaveAttribute('aria-selected', 'true')
  })

  test('backlink contexts highlight the link and property backlinks say via', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.click(tab(/^Backlinks/))
    const alpha = document.querySelector('[data-backlink="Pages/Alpha.md"]') as HTMLElement
    expect(within(alpha).getByText('Mentions in text')).toBeInTheDocument()
    const ctx = alpha.querySelector('[data-backlink-context] .search-highlights') as HTMLElement
    expect(ctx.textContent).toBe('See [[Self]] for more')
    expect(ctx.querySelector('b')?.textContent).toBe('[[Self]]')

    const bea = document.querySelector('[data-backlink="People/Bea.md"]') as HTMLElement
    expect(within(bea).getByText('via Works with')).toBeInTheDocument()
    expect(within(bea).queryByText('Mentions in text')).toBeNull()
    expect(within(bea).getByText('Person')).toBeInTheDocument() // the type chip's name
  })

  test('backlink click peeks with the backlinks list; ctrl+click opens a tab', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.click(tab(/^Backlinks/))
    await user.click(screen.getByRole('button', { name: /Bea/ }))
    expect(usePeek.getState().path).toBe('People/Bea.md')
    expect(usePeek.getState().list).toEqual(['Pages/Alpha.md', 'People/Bea.md'])
    usePeek.getState().close()

    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    await user.keyboard('{/Control}')
    expect(usePeek.getState().path).toBeNull()
    const s = useTabs.getState()
    const active = s.tabs.find((t) => t.id === s.activeId)!
    expect(active.history[active.index]).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
  })

  test('related show more raises the limit', async () => {
    const user = userEvent.setup()
    const related = Array.from({ length: 20 }, (_, i) => ({ path: `Pages/R${i}.md`, score: 20 - i }))
    mocked.references.mockResolvedValue({ ...FULL, related })
    await renderSection()
    await user.click(tab(/^Related Content/))
    expect(mocked.references).toHaveBeenLastCalledWith('Pages/Self.md', { relatedLimit: 20 })
    mocked.references.mockClear()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(mocked.references).toHaveBeenCalledWith('Pages/Self.md', { relatedLimit: 40 }))
    expect(mocked.references).toHaveBeenCalledTimes(1)
  })

  test('no Show more when fewer than the limit came back', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.click(tab(/^Related Content/))
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  test('related tags open the tag', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.click(tab(/^Related tags/))
    const pill = document.querySelector('[data-related-tag="work"]') as HTMLElement
    expect(pill.textContent).toBe('work2')
    await user.click(pill)
    const s = useTabs.getState()
    const active = s.tabs.find((t) => t.id === s.activeId)!
    expect(active.history[active.index]).toEqual({ kind: 'object', path: 'Tags/Work.md' })
    expect(mocked.ensureTag).not.toHaveBeenCalled()
  })

  test('reloads once on a burst of change events', async () => {
    await renderSection()
    expect(mocked.references).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    act(() => {
      for (let i = 0; i < 5; i++) for (const l of listeners) l({ kind: 'changed', path: `Pages/N${i}.md`, version: 'v' })
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    vi.useRealTimers()
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(2))
  })
})
