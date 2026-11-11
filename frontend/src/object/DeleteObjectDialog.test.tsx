import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { deleteObjectsLabel } from '@/lib/deleteText'
import { DeleteObjectDialog, DELETE_OBJECT_TEXT } from './DeleteObjectDialog'

describe('DeleteObjectDialog', () => {
  test('uses the catalog\'s delete wording: the Trash note and the shared delete button', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(<DeleteObjectDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete this note?')).toBeInTheDocument()
    expect(within(dialog).getByText('Moves it to the Trash, where it can be restored for 30 days.')).toBeInTheDocument()
    // M32: the menu row is "Delete" (it was "Delete object"); the button counts like the views' selection bar and the collection dialogs.
    expect(DELETE_OBJECT_TEXT.action).toBe('Delete')
    const button = within(dialog).getByRole('button', { name: deleteObjectsLabel(1) })
    await user.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  // M32: the dialog names what it deletes, and keeps its line about the Trash.
  test('with the note\'s title it asks \'Delete “Title”?\'', async () => {
    render(<DeleteObjectDialog open title="Groceries" onOpenChange={vi.fn()} onConfirm={vi.fn()} />)
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Groceries”?' })
    expect(within(dialog).getByText('Moves it to the Trash, where it can be restored for 30 days.')).toBeInTheDocument()
    expect(within(dialog).queryByText(/object/i, { selector: 'h2' })).toBeNull()
  })

  test('a blank title falls back to "Delete this note?"', async () => {
    render(<DeleteObjectDialog open title="  " onOpenChange={vi.fn()} onConfirm={vi.fn()} />)
    expect(await screen.findByRole('alertdialog', { name: 'Delete this note?' })).toBeInTheDocument()
  })
})
