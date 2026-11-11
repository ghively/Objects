// The walk's W10: the note page (and the peek) says beside its header items how many backlinks and
// mentions wait under the text, from the one references request the page already makes.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, references, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', basic: true })
const PATH = 'Pages/Self.md'
const SELF = objectSummary({ id: 'self-id', path: PATH, type: 'page', title: 'Self' })
const other = (t: string) => objectSummary({ path: `Pages/${t}.md`, title: t, type: 'page' })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([SELF, other('Alpha'), other('Gamma')])
  mocked.object.mockResolvedValue(objectDetail({ summary: SELF, frontmatter: { type: 'Page', title: 'Self' }, body: 'Hello.\n', version: 'v1' }))
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.references.mockResolvedValue(
    references({
      tabs: ['all', 'backlinks', 'related', 'mentions'],
      backlinks: [{ path: 'Pages/Alpha.md', contexts: [{ context: 'See [[Self]] for more', start: 4, end: 12 }], properties: [] }],
      mentions: [
        { path: 'Pages/Gamma.md', version: 'v1', occurrences: [{ start: 10, end: 14, text: 'self', context: 'talk about self here', contextStart: 0 }] },
      ],
      related: [],
      summaries: { 'Pages/Alpha.md': other('Alpha'), 'Pages/Gamma.md': other('Gamma') },
    }),
  )
})

describe.each(['page', 'peek'] as const)('the %s header counts what is under the text', (mode) => {
  test('test the count sits beside the type chip, and a click opens that tab of the references section', async () => {
    const user = userEvent.setup()
    const { container } = render(<ObjectView path={PATH} mode={mode} />)
    const count = await screen.findByTestId('reference-counts')
    expect(count).toHaveTextContent('1 backlink · 1 mention')
    // In the header, on the type chip's row.
    const header = container.querySelector('[data-page-title]') as HTMLElement
    expect(header.contains(count)).toBe(true)
    expect(count.parentElement?.querySelector('[data-type-chip]')).not.toBeNull()
    // One references request for the note: the count reads what the section fetched.
    expect(mocked.references).toHaveBeenCalledTimes(1)
    await user.click(within(count).getByRole('button', { name: '1 mention' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /Mentions/ })).toHaveAttribute('aria-selected', 'true'))
    // The unlinked mention is there to link, as before.
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tabpanel', 'mentions')
    expect(mocked.references).toHaveBeenCalledTimes(1)
  }, 20000)
})
