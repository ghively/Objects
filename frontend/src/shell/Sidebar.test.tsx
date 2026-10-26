import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { typeDef as makeType } from '@/test/mockApi'
import { Sidebar } from './Sidebar'

function typeDef(name: string, pluralName: string, icon: string, color: string): TypeDef {
  const id = name.toLowerCase()
  return makeType({ id, name, pluralName, folder: pluralName, icon: { type: 'iconify', val: icon }, color })
}

const TYPES: TypeDef[] = [
  typeDef('Task', 'Tasks', 'ph-check-circle', 'blue'),
  typeDef('Server', 'Servers', 'ph-hard-drives', 'purple'),
  typeDef('Person', 'People', 'ph-user', 'orange'),
  typeDef('DailyNote', 'DailyNotes', 'ph-calendar-blank', 'green'),
  { ...typeDef('Page', 'Pages', 'ph-file-text', 'pink'), basic: true },
]

describe('Sidebar', () => {
  it('test sidebar "+ New" enabled and type context menu items', async () => {
    const user = userEvent.setup()
    const onNew = vi.fn()
    const onCreateType = vi.fn()
    const onOpenTypeSettings = vi.fn()
    const onDeleteType = vi.fn()
    const onOpenTrash = vi.fn()
    render(
      <Sidebar
        types={TYPES}
        onNew={onNew}
        onCreateType={onCreateType}
        onOpenTypeSettings={onOpenTypeSettings}
        onDeleteType={onDeleteType}
        onOpenTrash={onOpenTrash}
      />,
    )
    const btn = screen.getByRole('button', { name: 'New' })
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create object type' }))
    expect(onCreateType).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Trash' }))
    expect(onOpenTrash).toHaveBeenCalledTimes(1)

    // A custom type: settings and delete.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Servers' }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Object Type Settings',
      'Delete object type',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete object type' }))
    expect(onDeleteType).toHaveBeenCalledWith(expect.objectContaining({ id: 'server' }))

    // A basic type: settings only.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Pages' }))
    menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Object Type Settings'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Object Type Settings' }))
    expect(onOpenTypeSettings).toHaveBeenCalledWith(expect.objectContaining({ id: 'page' }))
  })

  it('renders a disabled Graph placeholder', () => {
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(within(nav).getByRole('button', { name: 'Graph' })).toBeDisabled()
  })

  it('test sidebar Calendar and Tasks items open targets and show active state', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    const { rerender } = render(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    const calendar = within(nav).getByRole('button', { name: 'Calendar' })
    const tasks = within(nav).getByRole('button', { name: 'Tasks' })
    expect(calendar).toBeEnabled()
    expect(tasks).toBeEnabled()
    expect(calendar).not.toHaveAttribute('aria-current')
    await user.click(calendar)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'calendar' }, { newTab: false })
    await user.click(tasks)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'tasks' }, { newTab: false })
    fireEvent.click(calendar, { ctrlKey: true })
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'calendar' }, { newTab: true })
    await user.hover(calendar)
    expect(screen.queryByText(/arrives in M4/)).toBeNull()

    rerender(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} calendarActive />)
    expect(within(nav).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Tasks' })).not.toHaveAttribute('aria-current')
    rerender(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} tasksActive />)
    expect(within(nav).getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  it('test M3 sidebar items still present', () => {
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(within(nav).getByRole('button', { name: 'All notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queries' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument()
  })

  it('renders Pinned with an italic empty state', () => {
    render(<Sidebar types={TYPES} />)
    const pinned = screen.getByRole('region', { name: 'Pinned' })
    const empty = within(pinned).getByText('No pinned content')
    expect(empty).toHaveClass('italic')
  })

  it('lists object types alphabetically with coloured icon chips', () => {
    render(<Sidebar types={TYPES} />)
    const section = screen.getByRole('region', { name: 'Object Types' })
    const items = within(section)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-label') !== 'Create object type')
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      'DailyNotes',
      'Pages',
      'People',
      'Queries',
      'Servers',
      'Tasks',
    ])
    const tasks = items[5]
    const chip = tasks.querySelector('[data-type-chip]') as HTMLElement
    expect(chip).not.toBeNull()
    expect(chip.dataset.color).toBe('blue')
    expect(chip.dataset.icon).toBe('ph-check-circle')
    expect(chip.style.getPropertyValue('--chip-fg')).not.toBe('')
  })
})
