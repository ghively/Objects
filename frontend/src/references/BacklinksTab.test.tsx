import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { BacklinkEntry } from '@/api/types'
import { activeTab, currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { BACKLINKS_PAGE, BacklinksTab, HighlightedContext } from './BacklinksTab'

describe('HighlightedContext', () => {
  test('offsets are code points, so an emoji before the match does not shift the bold', () => {
    const { container } = render(<HighlightedContext context="🚀 see Ada here" start={6} end={9} />)
    expect(container.querySelector('b')?.textContent).toBe('Ada')
    expect(container.textContent).toBe('🚀 see Ada here')
  })
})

describe('BacklinksTab paging (audit 2026-11-01 F6)', () => {
  const entries: BacklinkEntry[] = Array.from({ length: 120 }, (_, i) => ({ path: `Pages/P${i}.md`, contexts: [], properties: [] }))

  test('shows 50 entries, then 50 more per "Load more", until all are shown', async () => {
    const user = userEvent.setup()
    render(<BacklinksTab entries={entries} summaries={{}} />)
    expect(BACKLINKS_PAGE).toBe(50)
    expect(document.querySelectorAll('[data-backlink]')).toHaveLength(50)
    const more = screen.getByRole('button', { name: 'Load more' })
    await user.click(more)
    expect(document.querySelectorAll('[data-backlink]')).toHaveLength(100)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(document.querySelectorAll('[data-backlink]')).toHaveLength(120)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  test('each linking block is an embedded reference: a leading dot and hover actions', async () => {
    const user = userEvent.setup()
    useTabs.getState().reset()
    usePeek.getState().close()
    const entry: BacklinkEntry = {
      path: 'Pages/Source.md',
      contexts: [{ context: 'See Ada here', start: 4, end: 7 }],
      properties: [],
    }
    render(<BacklinksTab entries={[entry]} summaries={{}} />)
    const ref = document.querySelector('[data-backlink-block]') as HTMLElement
    expect(ref.querySelector('[data-reference-dot]')).not.toBeNull()
    const actions = within(ref).getByRole('group', { name: 'Reference actions' })
    expect(within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Expand',
      'Open in new tab',
      'Open in side panel',
    ])
    await user.click(within(actions).getByRole('button', { name: 'Expand' }))
    expect(usePeek.getState().path).toBe('Pages/Source.md')
    await user.click(within(actions).getByRole('button', { name: 'Open in new tab' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Source.md' })
    await user.click(within(actions).getByRole('button', { name: 'Open in side panel' }))
    expect(activeTab(useTabs.getState())?.sidepanel?.[0]).toMatchObject({ target: { kind: 'object', path: 'Pages/Source.md' } })
  })

  test('a short list has no "Load more"', () => {
    render(<BacklinksTab entries={entries.slice(0, 3)} summaries={{}} />)
    expect(document.querySelectorAll('[data-backlink]')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})
