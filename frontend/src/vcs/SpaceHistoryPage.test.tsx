import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VcsCommit, VcsStatus } from '@/api/vcsClient'

vi.mock('@/api/vcsClient', () => ({
  vcsApi: { status: vi.fn(), log: vi.fn(), diff: vi.fn(), restore: vi.fn() },
}))
vi.mock('@/editor/media/upload', () => ({ showToast: vi.fn() }))

import { vcsApi } from '@/api/vcsClient'
import { showToast } from '@/editor/media/upload'
import { SpaceHistoryPage } from './SpaceHistoryPage'
import { useVcsStatus } from './useVcsStatus'

const api = vi.mocked(vcsApi)

const ON: VcsStatus = { target: 'space', gitAvailable: true, enabled: true, repository: true, root: '/s' }
const COMMITS: VcsCommit[] = [
  {
    sha: '2'.repeat(40), short: '2222222', author: 'Gene', at: '2026-11-08T12:00:00Z',
    message: 'Object: edit 1 object (Printer jams)', files: [{ status: 'M', path: 'Pages/Printer jams.md' }],
  },
  {
    sha: '1'.repeat(40), short: '1111111', author: 'Gene', at: '2026-11-08T10:00:00Z',
    message: 'Object: start version control', files: [{ status: 'A', path: 'Pages/Printer jams.md' }, { status: 'A', path: '.gitignore' }],
  },
]

beforeEach(() => {
  useVcsStatus.setState({ space: null })
  for (const fn of Object.values(api)) fn.mockReset()
  vi.mocked(showToast).mockReset()
})

describe('Space history', () => {
  it('lists commits, previews a diff and restores the space as a new commit', async () => {
    api.status.mockResolvedValue(ON)
    api.log.mockResolvedValue({ commits: COMMITS, more: false })
    api.diff.mockResolvedValue({
      sha: COMMITS[1].sha,
      files: [{ path: 'Pages/Printer jams.md', status: 'A', binary: false, truncated: false, diff: '@@ -0,0 +1 @@\n+Clear the tray.' }],
    })
    api.restore.mockResolvedValue({ commit: '3'.repeat(40), changed: ['Pages/Printer jams.md'], status: ON })
    const user = userEvent.setup()
    render(<SpaceHistoryPage />)
    const list = await screen.findByRole('listbox', { name: 'Space history' })
    const items = within(list).getAllByRole('option')
    expect(items.map((i) => i.querySelector('.font-medium')?.textContent)).toEqual([
      'Object: edit 1 object (Printer jams)',
      'Object: start version control',
    ])
    expect(items[1]).toHaveTextContent('2 files changed')
    expect(screen.getByText('Select a version')).toBeInTheDocument()

    await user.click(items[1])
    expect(api.diff).toHaveBeenCalledWith(COMMITS[1].sha)
    expect(await screen.findByText('+Clear the tray.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore space to this point' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Restore the whole space?')
    expect(dialog).toHaveTextContent('1111111')
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith(COMMITS[1].sha))
    expect(showToast).toHaveBeenCalledWith('Space restored')
    expect(api.log).toHaveBeenCalledTimes(2)
  })

  it('explains when version control is off', async () => {
    api.status.mockResolvedValue({ ...ON, enabled: false })
    api.log.mockResolvedValue({ commits: [], more: false })
    render(<SpaceHistoryPage />)
    expect(await screen.findByText('Version control is off for this space.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Version control' })).toBeInTheDocument()
  })

  it('shows a refused restore', async () => {
    api.status.mockResolvedValue(ON)
    api.log.mockResolvedValue({ commits: COMMITS, more: false })
    api.diff.mockResolvedValue({ sha: COMMITS[0].sha, files: [] })
    api.restore.mockRejectedValue(new Error('Another program has staged changes in this repository.'))
    const user = userEvent.setup()
    render(<SpaceHistoryPage />)
    const list = await screen.findByRole('listbox', { name: 'Space history' })
    await user.click(within(list).getAllByRole('option')[0])
    await user.click(screen.getByRole('button', { name: 'Restore space to this point' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another program has staged changes')
  })
})
