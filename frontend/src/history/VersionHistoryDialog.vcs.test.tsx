// 2026-11-08: the Version History dialog's "In version control" list (git versions of the object).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { objectDetail, objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/api/vcsClient', () => ({ vcsApi: { fileLog: vi.fn(), file: vi.fn(), fileRestore: vi.fn() } }))

import { api } from '@/api/client'
import { vcsApi } from '@/api/vcsClient'
import { useVersionHistory } from './useVersionHistory'
import { VersionHistoryDialog } from './VersionHistoryDialog'

const mocked = vi.mocked(api)
const vcs = vi.mocked(vcsApi)
const PATH = 'Pages/Notes.md'

beforeEach(() => {
  mocked.history.mockResolvedValue([])
  mocked.object.mockImplementation(async (path: string) => objectDetail({ summary: objectSummary({ path }), version: 'v-current' }))
  vcs.fileLog.mockResolvedValue([
    { sha: 'c'.repeat(40), short: 'ccccccc', author: 'Gene', at: '2026-11-08T10:00:00Z', message: 'Object: edit 1 object (Notes)', path: PATH, status: 'M' },
    { sha: 'd'.repeat(40), short: 'ddddddd', author: 'Gene', at: '2026-11-07T10:00:00Z', message: 'Object: start version control', path: 'Pages/Old name.md', status: 'A' },
  ])
  vcs.file.mockResolvedValue({ sha: 'd'.repeat(40), text: '---\ntitle: Notes\n---\nThe first words.\n' })
  vcs.fileRestore.mockResolvedValue({ version: 'v-new', commit: 'e'.repeat(40) })
})

afterEach(() => {
  act(() => useVersionHistory.getState().close())
  vi.clearAllMocks()
})

describe('VersionHistoryDialog: versions in version control', () => {
  test('lists the commits, previews one and restores it as a new commit', async () => {
    render(<VersionHistoryDialog />)
    act(() => useVersionHistory.getState().open(PATH))
    const list = await screen.findByRole('listbox', { name: 'In version control' })
    expect(screen.queryByText('No earlier versions')).not.toBeInTheDocument()
    const items = within(list).getAllByRole('option')
    expect(items.map((i) => i.getAttribute('data-commit'))).toEqual(['ccccccc', 'ddddddd'])
    fireEvent.click(items[1])
    await waitFor(() => expect(vcs.file).toHaveBeenCalledWith(PATH, 'd'.repeat(40), 'Pages/Old name.md'))
    expect(await screen.findByText('The first words.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Bring back the object as it was in ddddddd?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(vcs.fileRestore).toHaveBeenCalledWith(PATH, 'd'.repeat(40), 'v-current', 'Pages/Old name.md'))
    await waitFor(() => expect(useVersionHistory.getState().path).toBeNull())
  })

  test('no version control: only the saved versions, as before', async () => {
    vcs.fileLog.mockRejectedValue(new Error('off'))
    render(<VersionHistoryDialog />)
    act(() => useVersionHistory.getState().open(PATH))
    expect(await screen.findByText('No earlier versions')).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'In version control' })).not.toBeInTheDocument()
  })
})
