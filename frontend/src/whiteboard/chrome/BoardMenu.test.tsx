import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { BoardMenu } from './BoardMenu'

test('test clear whiteboard dialog strings and confirm', async () => {
  const user = userEvent.setup()
  const onClear = vi.fn()
  const onDelete = vi.fn()
  render(<BoardMenu onClear={onClear} onDelete={onDelete} />)
  await user.click(screen.getByRole('button', { name: 'More options' }))
  const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
  expect(items.map((i) => i.textContent)).toEqual(['Clear Whiteboard', 'Delete'])
  await user.click(screen.getByRole('menuitem', { name: 'Clear Whiteboard' }))

  const dialog = screen.getByRole('alertdialog')
  expect(within(dialog).getByText('Clear this whiteboard?')).toBeInTheDocument()
  expect(within(dialog).getByText('Everything on the canvas, objects and connectors, will be removed. Undo brings it back.')).toBeInTheDocument()
  // Cancel closes without clearing.
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(onClear).not.toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'More options' }))
  await user.click(screen.getByRole('menuitem', { name: 'Clear Whiteboard' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear Whiteboard' }))
  expect(onClear).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(onDelete).not.toHaveBeenCalled()
})

test('delete and open as page', async () => {
  const user = userEvent.setup()
  const onDelete = vi.fn()
  const onOpenAsPage = vi.fn()
  render(<BoardMenu onClear={vi.fn()} onDelete={onDelete} onOpenAsPage={onOpenAsPage} />)
  await user.click(screen.getByRole('button', { name: 'More options' }))
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
    'Open as page',
    'Clear Whiteboard',
    'Delete',
  ])
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(onDelete).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'More options' }))
  await user.click(screen.getByRole('menuitem', { name: 'Open as page' }))
  expect(onOpenAsPage).toHaveBeenCalledTimes(1)
})

test('clear is disabled on a locked or read-only board', async () => {
  const user = userEvent.setup()
  render(<BoardMenu onClear={vi.fn()} onDelete={vi.fn()} disabled />)
  await user.click(screen.getByRole('button', { name: 'More options' }))
  expect(screen.getByRole('menuitem', { name: 'Clear Whiteboard' })).toBeDisabled()
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeEnabled()
})

test('version history row', async () => {
  const user = userEvent.setup()
  const onVersionHistory = vi.fn()
  render(<BoardMenu onClear={vi.fn()} onDelete={vi.fn()} onVersionHistory={onVersionHistory} disabled />)
  await user.click(screen.getByRole('button', { name: 'More options' }))
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
    'Version History',
    'Clear Whiteboard',
    'Delete',
  ])
  // Offered on a locked or read-only board too (reading history writes nothing).
  await user.click(screen.getByRole('menuitem', { name: 'Version History' }))
  expect(onVersionHistory).toHaveBeenCalledTimes(1)
})
