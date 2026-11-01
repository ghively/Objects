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
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const make = (path: string, type: string, createdAt: string): Row =>
  row({ summary: objectSummary({ path, type, createdAt }) })

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
  useLinkIndex.setState({ types: [PAGE, TASK, DAILY], objects: [], loaded: true })
})

describe('AllNotesView', () => {
  test('test All notes excludes daily notes and tasks and groups by created', async () => {
    mocked.rows.mockResolvedValue([
      make('Pages/Old.md', 'page', daysAgo(60)),
      make('Pages/New.md', 'page', daysAgo(0)),
      make('Tasks/Do.md', 'task', daysAgo(0)),
      make('Daily/2026-10-26.md', 'dailynote', daysAgo(0)),
    ])
    render(<AllNotesView />)
    expect(screen.getByRole('heading', { name: 'All notes' })).toBeInTheDocument()
    expect(screen.getByText('All notes in this space, grouped by when they were created.')).toBeInTheDocument()
    await screen.findByText('New')
    expect(screen.queryByText('Do')).not.toBeInTheDocument()
    expect(screen.queryByText('2026-10-26')).not.toBeInTheDocument()
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['page'], preview: false })
    const headers = screen.getAllByTestId('group-header').map((h) => h.textContent)
    // Newest first.
    expect(headers[0]).toMatch(/^Today/)
    expect(headers[1]).toMatch(/^Earlier/)
  })

  test('test All notes layout saved to ui', async () => {
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
    expect(screen.getByText('Notes you create will appear here.')).toBeInTheDocument()
  })
})
