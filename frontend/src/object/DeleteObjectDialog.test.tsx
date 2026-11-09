import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { deleteObjectsLabel } from '@/lib/deleteText'
import { DeleteObjectDialog, DELETE_OBJECT_TEXT } from './DeleteObjectDialog'

describe('DeleteObjectDialog', () => {
  test('uses the catalog\'s delete wording: the Trash note and a "Delete 1 object" button', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(<DeleteObjectDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete this object?')).toBeInTheDocument()
    expect(within(dialog).getByText('Moves it to the Trash, where it can be restored for 30 days.')).toBeInTheDocument()
    // The menu row stays "Delete object"; the button counts like the views' selection bar and the collection dialogs.
    expect(DELETE_OBJECT_TEXT.action).toBe('Delete object')
    const button = within(dialog).getByRole('button', { name: deleteObjectsLabel(1) })
    expect(button).toHaveTextContent('Delete 1 object')
    await user.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
