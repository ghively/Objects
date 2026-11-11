import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row } from '@/api/types'
import { objectSummary, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { resetPinned } from '@/shell/usePinned'
import { useDefs } from '@/types/useDefinitions'
import { AllNotesView } from './AllNotesView'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
const TAG = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true })
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const make = (path: string, type: string, lastUpdated: string | null, createdAt: string | null = null): Row =>
  row({ summary: objectSummary({ path, type, lastUpdated, createdAt }) })

beforeEach(() => {
  resetLinkIndex()
  resetPinned()
  useDefs.setState({ collections: [], queries: [], loaded: true })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockResolvedValue({ ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'u1' })
  mocked.patchUi.mockImplementation(async (patch) => ({
    ui: { pinned: [], sections: [], allNotesLayout: 'list', ...patch },
    revision: 'u2',
  }))
  useLinkIndex.setState({ types: [PAGE, TASK, TAG, DAILY], objects: [], loaded: true })
})

describe('AllNotesView (M32: Notes)', () => {
  test('test Notes lists every note by last edited, daily notes in, tasks and tags out', async () => {
    mocked.rows.mockResolvedValue([
      make('Pages/Old.md', 'page', daysAgo(60)),
      make('Pages/New.md', 'page', daysAgo(0)),
      make('Tasks/Do.md', 'task', daysAgo(0)),
      make('Tags/home.md', 'tag', daysAgo(0)),
      make('Daily/2026-10-26.md', 'dailynote', daysAgo(0)),
    ])
    render(<AllNotesView />)
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByText('Every note, by when it was last edited.')).toBeInTheDocument()
    await screen.findByText('New')
    expect(screen.getByText('2026-10-26')).toBeInTheDocument()
    expect(screen.queryByText('Do')).not.toBeInTheDocument()
    expect(screen.queryByText('home')).not.toBeInTheDocument()
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['page', 'dailynote'], preview: false })
  })

  test('test Notes groups Today, Yesterday, This week, Earlier, newest first inside each', async () => {
    mocked.rows.mockResolvedValue([
      make('Pages/LastMonth.md', 'page', daysAgo(40)),
      make('Pages/FourDays.md', 'page', daysAgo(4)),
      make('Pages/Yesterday.md', 'page', daysAgo(1)),
      // No last update yet: the creation time counts.
      make('Pages/Fresh.md', 'page', null, new Date(Date.now() - 60_000).toISOString()),
      make('Pages/Now.md', 'page', new Date().toISOString()),
      make('Pages/NoStamp.md', 'page', null),
    ])
    render(<AllNotesView />)
    await screen.findByText('Now')
    const headers = screen.getAllByTestId('group-header').map((h) => h.textContent)
    expect(headers.map((h) => h?.replace(/\d+$/, ''))).toEqual(['Today', 'Yesterday', 'This week', 'Earlier'])
    const titles = [...document.querySelectorAll('li[data-path]')].map((li) => li.getAttribute('data-path'))
    expect(titles).toEqual([
      'Pages/Now.md',
      'Pages/Fresh.md',
      'Pages/Yesterday.md',
      'Pages/FourDays.md',
      'Pages/LastMonth.md',
      'Pages/NoStamp.md',
    ])
  })

  test('test Notes layout saved to ui', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([make('Pages/New.md', 'page', daysAgo(0))])
    render(<AllNotesView />)
    await screen.findByText('New')
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Gallery' }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledWith({ allNotesLayout: 'grid' }, { baseRevision: 'u1' }))
  })

  test('test empty state', async () => {
    mocked.rows.mockResolvedValue([])
    render(<AllNotesView />)
    expect(await screen.findByText('No notes yet')).toBeInTheDocument()
    expect(screen.getByText('New notes show up here.')).toBeInTheDocument()
  })
})
