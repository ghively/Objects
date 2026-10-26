import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { collection } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConfirmRequiredError } from '@/api/client'
import { CreateCollectionDialog, DeleteCollectionDialog, RemoveFromCollectionDialog } from './CollectionDialogs'

const mocked = vi.mocked(api)
const C = collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'], revision: 'r1' })

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.objects.mockResolvedValue([])
})

describe('DeleteCollectionDialog', () => {
  test('test delete dialog shows affected count then confirms', async () => {
    const user = userEvent.setup()
    mocked.deleteCollection.mockRejectedValueOnce(new ConfirmRequiredError('confirm', 3))
    mocked.deleteCollection.mockResolvedValueOnce({ trashId: 't1', removedFrom: [], skipped: [], deleted: [] })
    const onOpenChange = vi.fn()
    render(<DeleteCollectionDialog collection={C} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('Do you really want to delete this collection?')).toBeInTheDocument()
    expect(screen.getByText(/By deleting a collection all entries will be removed as well/)).toBeInTheDocument()
    expect(screen.getByText(/Everything moves to the Trash/)).toBeInTheDocument()
    expect(await screen.findByText('3 objects are affected.')).toBeInTheDocument()
    expect(mocked.deleteCollection).toHaveBeenCalledTimes(1)
    expect(mocked.deleteCollection).toHaveBeenLastCalledWith('tooling')
    await user.click(screen.getByRole('button', { name: 'Delete collection' }))
    await waitFor(() => expect(mocked.deleteCollection).toHaveBeenLastCalledWith('tooling', { confirm: true }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('test delete reports skipped members', async () => {
    const user = userEvent.setup()
    mocked.deleteCollection.mockRejectedValueOnce(new ConfirmRequiredError('confirm', 2))
    mocked.deleteCollection.mockResolvedValueOnce({
      trashId: 't1',
      removedFrom: [],
      skipped: [{ path: 'Servers/Alpha.md', reason: 'read-only' }],
      deleted: [],
    })
    const onDeleted = vi.fn()
    render(<DeleteCollectionDialog collection={C} open onOpenChange={() => undefined} onDeleted={onDeleted} />)
    await screen.findByText('2 objects are affected.')
    await user.click(screen.getByRole('button', { name: 'Delete collection' }))
    expect(await screen.findByText("1 object couldn't be updated and still list this collection.")).toBeInTheDocument()
    expect(screen.getByText('Servers/Alpha.md')).toBeInTheDocument()
    expect(onDeleted).toHaveBeenCalled()
  })
})

describe('CreateCollectionDialog', () => {
  test('creates with the default name for the type', async () => {
    const user = userEvent.setup()
    mocked.createCollection.mockResolvedValue(collection({ id: 'new-collection', name: 'New Collection', typeIds: ['server'] }))
    const onCreated = vi.fn()
    render(<CreateCollectionDialog open onOpenChange={() => undefined} typeId="server" onCreated={onCreated} />)
    expect(screen.getByText(/One entry can be part of several collections/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Collection name' })).toHaveValue('New Collection')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))
    await waitFor(() => expect(mocked.createCollection).toHaveBeenCalledWith('New Collection', ['server']))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })
})

describe('RemoveFromCollectionDialog', () => {
  test('test remove from collection dialog offers remove and delete', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const onDelete = vi.fn()
    render(<RemoveFromCollectionDialog open onOpenChange={() => undefined} count={2} onRemove={onRemove} onDelete={onDelete} />)
    expect(screen.getByText('Remove from collection?')).toBeInTheDocument()
    expect(screen.getByText('Remove from this collection, or delete everywhere below.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove from collection' }))
    expect(onRemove).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete 2 objects' }))
    expect(onDelete).toHaveBeenCalled()
  })
})
