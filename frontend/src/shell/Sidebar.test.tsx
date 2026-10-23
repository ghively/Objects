import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TypeDef } from '@/api/types'
import { Sidebar } from './Sidebar'

function typeDef(name: string, pluralName: string, icon: string, color: string): TypeDef {
  const id = name.toLowerCase()
  return { id, name, pluralName, folder: pluralName, icon, color, propertyDefinitions: [] }
}

const TYPES: TypeDef[] = [
  typeDef('Task', 'Tasks', 'ph-check-circle', 'blue'),
  typeDef('Server', 'Servers', 'ph-hard-drives', 'purple'),
  typeDef('Person', 'People', 'ph-user', 'orange'),
  typeDef('DailyNote', 'DailyNotes', 'ph-calendar-blank', 'green'),
  typeDef('Page', 'Pages', 'ph-file-text', 'pink'),
]

describe('Sidebar', () => {
  it('renders the + New button, disabled until M2', () => {
    render(<Sidebar types={TYPES} />)
    const btn = screen.getByRole('button', { name: /new/i })
    expect(btn).toBeDisabled()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('renders disabled Calendar, Tasks and Graph placeholders', () => {
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    for (const label of ['Calendar', 'Tasks', 'Graph']) {
      expect(within(nav).getByRole('button', { name: label })).toBeDisabled()
    }
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
    const items = within(section).getAllByRole('button')
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      'DailyNotes',
      'Pages',
      'People',
      'Servers',
      'Tasks',
    ])
    const tasks = items[4]
    const chip = tasks.querySelector('[data-type-chip]') as HTMLElement
    expect(chip).not.toBeNull()
    expect(chip.dataset.color).toBe('blue')
    expect(chip.dataset.icon).toBe('ph-check-circle')
    expect(chip.style.getPropertyValue('--chip-fg')).not.toBe('')
  })
})
