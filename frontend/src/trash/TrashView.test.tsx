import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TrashItem } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { TrashView } from './TrashView'

const mocked = vi.mocked(api)

const NOTE: TrashItem = {
  id: 'o1',
  kind: 'object',
  originalPath: 'Pages/Note.md',
  title: 'Note',
  type: 'Page',
  deletedAt: '2026-10-20T10:00:00.000Z',
}
const BOOK_TYPE: TrashItem = {
  id: 't1',
  kind: 'type',
  originalPath: '.object/types/book.json',
  title: 'Book',
  type: 'Book',
  deletedAt: '2026-10-21T10:00:00.000Z',
  objectCount: 3,
}
const BOOK_OBJECT: TrashItem = { ...NOTE, id: 'o2', originalPath: 'Books/Dune.md', title: 'Dune', type: 'Book', typeTrashId: 't1' }

let entries: TrashItem[]

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  entries = [NOTE, BOOK_TYPE, BOOK_OBJECT]
  mocked.trash.mockImplementation(async () => entries)
})

describe('TrashView', () => {
  test('lists objects and types (a type with its object count), with the 30-day info', async () => {
    render(<TrashView />)
    const list = await screen.findByRole('list', { name: 'Trash' })
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Note', 'Book'])
    expect(within(list).getByRole('listitem', { name: 'Book' })).toHaveTextContent('3 objects')
    expect(screen.getByText(/30 days/)).toHaveTextContent(/not the Windows Recycle Bin/)
  })

  test('test Empty Trash requires typing "Delete"', async () => {
    const user = userEvent.setup()
    render(<TrashView />)
    await screen.findByRole('list', { name: 'Trash' })
    await user.click(screen.getByRole('button', { name: 'Empty Trash' }))
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Empty Trash' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Type "Delete" to confirm' }), 'delete')
    expect(confirm).toBeDisabled()
    await user.clear(within(dialog).getByRole('textbox'))
    await user.type(within(dialog).getByRole('textbox'), 'Delete')
    expect(confirm).toBeEnabled()
    entries = []
    await user.click(confirm)
    await waitFor(() => expect(mocked.emptyTrash).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument()
  })

  test('test restoring a type entry calls restore and lists the type again', async () => {
    const user = userEvent.setup()
    mocked.restore.mockImplementation(async () => {
      entries = [NOTE]
      return { paths: ['Books/Dune.md'], typeIds: ['book'] }
    })
    mocked.space.mockResolvedValue({
      name: 's',
      root: '/s',
      types: [{ id: 'book', name: 'Book' } as never],
    })
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Book' })
    await user.click(within(row).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(mocked.restore).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Book' })).not.toBeInTheDocument())
    // The index reloads, so the sidebar lists the type again.
    await waitFor(() => expect(useLinkIndex.getState().types.map((t) => t.id)).toContain('book'))
  })

  test('Delete permanently purges one entry only after confirming', async () => {
    const user = userEvent.setup()
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Note' })
    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Permanently delete' })
    expect(dialog).toHaveTextContent(
      'Are you sure you want to permanently delete 1 object(s)? This action cannot be undone.',
    )
    expect(mocked.purge).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocked.purge).not.toHaveBeenCalled()

    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const again = await screen.findByRole('alertdialog', { name: 'Permanently delete' })
    await user.click(within(again).getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(mocked.purge).toHaveBeenCalledWith('o1'))
  })

  test('a type row counts the type and its objects', async () => {
    const user = userEvent.setup()
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Book' })
    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Permanently delete' })
    expect(dialog).toHaveTextContent('permanently delete 4 object(s)?')
  })
})
