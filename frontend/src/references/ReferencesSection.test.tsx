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
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { resetOpenAsFullPage, setOpenAsFullPage } from '@/test/fullPage'
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
  resetOpenAsFullPage()
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
    expect(tab(/^Backlinks/).querySelector('[title="Links to this note"]')).not.toBeNull()
    expect(tab(/^Related Content/).querySelector('[title="Similar notes"]')).not.toBeNull()
    expect(tab(/^Mentions/).querySelector('[title="Unlinked name matches"]')).not.toBeNull()
    expect(tab(/^All/)).toHaveAttribute('title', 'Click again to hide')
    expect(tab(/^Backlinks/)).not.toHaveAttribute('title')

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('No backlinks yet')).toBeInTheDocument()
    expect(within(panel).getByText('No related content yet')).toBeInTheDocument()
    expect(within(panel).getByText('No unlinked mentions')).toBeInTheDocument()
    expect(within(panel).getByText('No related tags')).toBeInTheDocument()
  })

  // M32, item 11: an empty note's references are four quiet lines, not four headings with blocks.
  test('an empty section is one quiet line: no heading and no explanation (M32)', async () => {
    mocked.references.mockResolvedValue(
      references({ tabs: ['all', 'backlinks', 'related', 'mentions', 'relatedTags'], summaries }),
    )
    const user = userEvent.setup()
    await renderSection()
    const panel = screen.getByRole('tabpanel')
    const lines = [...panel.querySelectorAll('[data-references-empty]')].map((el) => el.textContent)
    expect(lines).toEqual(['No backlinks yet', 'No related content yet', 'No unlinked mentions', 'No related tags'])
    expect(within(panel).queryAllByRole('heading')).toEqual([])
    expect(within(panel).queryByText(/show up here|will appear here/)).toBeNull()
    // Each part is still there, in tab order, marked empty.
    const parts = [...panel.querySelectorAll('[data-all-part]')]
    expect(parts.map((el) => el.getAttribute('data-all-part'))).toEqual(['backlinks', 'related', 'mentions', 'relatedTags'])
    expect(parts.every((el) => el.hasAttribute('data-part-empty'))).toBe(true)
    // Every tab stays, each with its count; a tab on its own shows the same single line.
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('data-tab'))).toEqual(['all', 'backlinks', 'related', 'mentions', 'relatedTags'])
    await user.click(tab(/^Backlinks/))
    const own = screen.getByRole('tabpanel')
    expect(own.textContent).toBe('No backlinks yet')
  })

  // Ground rule: unlinked mentions are never removed or hidden.
  test('the Mentions tab stays on an empty note and says so in one line (M32)', async () => {
    mocked.references.mockResolvedValue(references({ tabs: ['all', 'backlinks', 'related', 'mentions'], summaries }))
    const user = userEvent.setup()
    await renderSection()
    expect(tab(/^Mentions/).querySelector('[data-tab-count]')?.textContent).toBe('0')
    expect(tab(/^Mentions/).querySelector('[title="Unlinked name matches"]')).not.toBeNull()
    await user.click(tab(/^Mentions/))
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tabpanel', 'mentions')
    expect(screen.getByRole('tabpanel').textContent).toBe('No unlinked mentions')
  })

  test('unlinked mentions always show when there are any, under their heading, among empty sections (M32)', async () => {
    mocked.references.mockResolvedValue(
      references({ tabs: ['all', 'backlinks', 'related', 'mentions', 'relatedTags'], mentions: FULL.mentions, summaries }),
    )
    const user = userEvent.setup()
    await renderSection()
    expect(tab(/^Mentions/).querySelector('[data-tab-count]')?.textContent).toBe('1')
    const panel = screen.getByRole('tabpanel')
    // The one section with content keeps its heading and its list; the empty ones are lines.
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Mentions'])
    const part = panel.querySelector('[data-all-part="mentions"]') as HTMLElement
    expect(part).not.toHaveAttribute('data-part-empty')
    const mention = part.querySelector('[data-mention="Pages/Gamma.md"]') as HTMLElement
    expect(within(mention).getByText('Gamma')).toBeInTheDocument()
    expect(mention.querySelector('[data-occurrence] .search-highlights')?.textContent).toBe('talk about self here')
    expect(within(mention).getByRole('button', { name: 'Link' })).toBeEnabled()
    expect(panel.querySelectorAll('[data-references-empty]')).toHaveLength(3)
    expect(within(panel).queryByText('No unlinked mentions')).toBeNull()
    // And "Link" still works from here.
    await user.click(within(mention).getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(mocked.linkMention).toHaveBeenCalledWith({
        path: 'Pages/Gamma.md',
        target: SELF.path,
        start: 10,
        end: 14,
        text: 'self',
        baseVersion: 'vg1',
      }),
    )
  })

  test('a section the user closed still shows its mentions heading, so they can be opened again (M32)', async () => {
    localStorage.setItem(referencesKey('self-id'), JSON.stringify({ tab: 'all', closed: false, parts: { mentions: false } }))
    mocked.references.mockResolvedValue(references({ tabs: ['all', 'backlinks', 'mentions'], mentions: FULL.mentions, summaries }))
    const user = userEvent.setup()
    await renderSection()
    const panel = screen.getByRole('tabpanel')
    const toggle = within(panel).getByRole('button', { name: 'Mentions' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel.querySelector('[data-mention]')).toBeNull()
    await user.click(toggle)
    expect(panel.querySelector('[data-mention="Pages/Gamma.md"]')).not.toBeNull()
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
    // M32: the built-in Page type reads "Note" beside a reference.
    expect(within(alpha).getByText('Note')).toBeInTheDocument()
    expect(within(alpha).queryByText('Page')).toBeNull()
  })

  test('backlink click opens the note as a full page (M32)', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.click(tab(/^Backlinks/))
    await user.click(screen.getByRole('button', { name: /Bea/ }))
    expect(usePeek.getState().path).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'People/Bea.md' })
  })

  test('with full pages off a backlink click peeks with the backlinks list; ctrl+click opens a tab', async () => {
    setOpenAsFullPage(false)
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
