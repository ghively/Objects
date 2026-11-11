// The side panel's Backlinks entry. M32: an empty list is one quiet line (no heading above it);
// unlinked mentions always show when there are any (ground rule).
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { objectSummary, references, typeDef } from '@/test/mockApi'
import { BacklinksPanel } from './BacklinksPanel'

const mocked = vi.mocked(api)
const PATH = 'Pages/Self.md'
const summaries = {
  'Pages/Alpha.md': objectSummary({ path: 'Pages/Alpha.md', title: 'Alpha' }),
  'Pages/Gamma.md': objectSummary({ path: 'Pages/Gamma.md', title: 'Gamma' }),
}
const MENTION = {
  path: 'Pages/Gamma.md',
  version: 'vg1',
  occurrences: [{ start: 10, end: 14, text: 'self', context: 'talk about self here', contextStart: 0 }],
}

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page' })], objects: [], loaded: true })
  mocked.references.mockReset()
  mocked.onChange.mockImplementation(() => () => undefined)
})

describe('BacklinksPanel', () => {
  test('nothing to show: two quiet lines, no headings', async () => {
    mocked.references.mockResolvedValue(references({ tabs: ['all', 'backlinks', 'related', 'mentions'] }))
    const { container } = render(<BacklinksPanel path={PATH} />)
    expect(await screen.findByText('No backlinks yet')).toBeInTheDocument()
    expect(screen.getByText('No unlinked mentions')).toBeInTheDocument()
    expect(screen.queryAllByRole('heading')).toEqual([])
    expect(container.querySelectorAll('[data-references-empty]')).toHaveLength(2)
  })

  test('unlinked mentions show under their heading even with no backlinks', async () => {
    mocked.references.mockResolvedValue(references({ tabs: ['all', 'backlinks', 'mentions'], mentions: [MENTION], summaries }))
    const { container } = render(<BacklinksPanel path={PATH} />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Mentions' })).toBeInTheDocument()
    const mention = container.querySelector('[data-mention="Pages/Gamma.md"]') as HTMLElement
    expect(within(mention).getByText('Gamma')).toBeInTheDocument()
    expect(within(mention).getByRole('button', { name: 'Link' })).toBeInTheDocument()
    expect(screen.getByText('No backlinks yet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Backlinks' })).toBeNull()
  })

  test('backlinks keep their heading and list', async () => {
    mocked.references.mockResolvedValue(
      references({
        tabs: ['all', 'backlinks', 'mentions'],
        backlinks: [{ path: 'Pages/Alpha.md', contexts: [{ context: 'See [[Self]]', start: 4, end: 12 }], properties: [] }],
        summaries,
      }),
    )
    const { container } = render(<BacklinksPanel path={PATH} />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Backlinks' })).toBeInTheDocument()
    expect(container.querySelector('[data-backlink="Pages/Alpha.md"]')).not.toBeNull()
    expect(screen.getByText('No unlinked mentions')).toBeInTheDocument()
  })

  test('no object, or one whose type has no references: "Backlinks not available"', async () => {
    const first = render(<BacklinksPanel path={null} />)
    expect(screen.getByText('Backlinks not available')).toBeInTheDocument()
    first.unmount()
    mocked.references.mockResolvedValue(references({ tabs: [] }))
    render(<BacklinksPanel path={PATH} />)
    expect(await screen.findByText('Backlinks not available')).toBeInTheDocument()
  })
})
