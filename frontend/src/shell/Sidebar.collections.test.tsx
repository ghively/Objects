import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { TypeDef } from '@/api/types'
import { collection, typeDef as makeType } from '@/test/mockApi'
import { Sidebar } from './Sidebar'

const mocked = vi.mocked(api)

const typeOf = (name: string, plural: string): TypeDef =>
  makeType({ id: name.toLowerCase(), name, pluralName: plural, folder: plural })
const TYPES = [typeOf('Server', 'Servers'), typeOf('Task', 'Tasks')]

beforeEach(() => {
  localStorage.clear()
  mocked.collections = vi.fn(async () => [
    collection({ id: 'todo', name: 'To Do', typeIds: ['task'], revision: 'r1' }),
    collection({ id: 'in-progress', name: 'In Progress', typeIds: ['task'], revision: 'r1' }),
    // One collection can belong to several types and shows under each.
    collection({ id: 'patch-1', name: 'Patch group 1', typeIds: ['server', 'task'], revision: 'r1' }),
  ])
})

describe('Sidebar collections', () => {
  it('lists a type\'s collections under its row, by name', async () => {
    render(<Sidebar types={TYPES} />)
    const tasks = await screen.findByRole('list', { name: 'Tasks collections' })
    const names = within(tasks)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual(['In Progress', 'Patch group 1', 'To Do'])
    const servers = screen.getByRole('list', { name: 'Servers collections' })
    expect(within(servers).getAllByRole('button').map((b) => b.textContent)).toEqual(['Patch group 1'])
  })

  it('opens a collection, in a new tab on Ctrl+click, and marks the open one', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    render(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} activeCollectionId="todo" />)
    const list = await screen.findByRole('list', { name: 'Tasks collections' })
    expect(within(list).getByRole('button', { name: 'To Do' })).toHaveAttribute('aria-current', 'page')
    expect(within(list).getByRole('button', { name: 'In Progress' })).not.toHaveAttribute('aria-current')
    await user.click(within(list).getByRole('button', { name: 'In Progress' }))
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'collection', id: 'in-progress' }, { newTab: false })
    await user.keyboard('{Control>}')
    await user.click(within(list).getByRole('button', { name: 'To Do' }))
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'collection', id: 'todo' }, { newTab: true })
  })

  it('folds and unfolds a type\'s collections and remembers it', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Sidebar types={TYPES} />)
    await screen.findByRole('list', { name: 'Tasks collections' })
    const hide = screen.getAllByRole('button', { name: 'Hide collections' })
    await user.click(hide[hide.length - 1]) // Tasks sorts after Servers
    expect(screen.queryByRole('list', { name: 'Tasks collections' })).toBeNull()
    expect(screen.getByRole('list', { name: 'Servers collections' })).toBeInTheDocument()
    unmount()
    // A new sidebar starts with the same fold.
    render(<Sidebar types={TYPES} />)
    await screen.findByRole('list', { name: 'Servers collections' })
    expect(screen.queryByRole('list', { name: 'Tasks collections' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show collections' }))
    await waitFor(() => expect(screen.getByRole('list', { name: 'Tasks collections' })).toBeInTheDocument())
  })

  it('shows no list and no fold button for a type without collections', async () => {
    mocked.collections = vi.fn(async () => [])
    render(<Sidebar types={TYPES} />)
    await screen.findByRole('button', { name: /Servers/ })
    expect(screen.queryByRole('list', { name: /collections/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /collections/ })).toBeNull()
  })
})
