import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'
import { AddPropertyMenu } from './AddPropertyMenu'
import { ADD_PROPERTY_ITEMS } from './kinds'

const PAGE = typeDef({ id: 'page', name: 'Page', basic: true })
const TAG = typeDef({ id: 'tag', name: 'Tag', basic: true })
const TASK = typeDef({ id: 'task', name: 'Task', basic: true })
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People' })
const PROJECT = typeDef({
  id: 'project',
  name: 'Project',
  propertyDefinitions: [propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })],
})
const TYPES = [PAGE, TAG, TASK, PERSON, PROJECT]

function items() {
  return screen.getAllByRole('menuitem').map((b) => b.getAttribute('aria-label'))
}

describe('AddPropertyMenu', () => {
  test('test AddPropertyMenu lists 24 items in order, hides existing Title, and Object Select › Person creates an entity bound to person', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AddPropertyMenu type={typeDef({ id: 'empty' })} types={TYPES} onSave={vi.fn()} />)
    expect(screen.getByText('Add Property')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search Properties')).toBeInTheDocument()
    expect(items()).toEqual(ADD_PROPERTY_ITEMS.map((i) => i.name))
    expect(items()).toHaveLength(24)
    unmount()

    const onSave = vi.fn()
    render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    expect(items()).toHaveLength(23)
    expect(items()).not.toContain('Title')

    await user.click(screen.getByRole('menuitem', { name: 'Object Select' }))
    expect(screen.getByPlaceholderText('Search Object Types')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Object types' })
    expect(within(list).getByText('Person')).toBeInTheDocument()
    expect(within(list).getByText('Page')).toBeInTheDocument()
    expect(within(list).queryByText('Task')).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Person' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Person')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const next: TypeDef = onSave.mock.calls[0][0]
    const added = next.propertyDefinitions.at(-1)!
    expect(added).toMatchObject({ type: 'entity', key: 'person', name: 'Person' })
    expect(added.options).toMatchObject({ isArray: true, allowedTypes: ['person'] })
  })

  test('search filters and Ctrl+Enter submits the form', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    await user.type(screen.getByPlaceholderText('Search Properties'), 'numb')
    expect(items()).toEqual(['Number'])
    await user.click(screen.getByRole('menuitem', { name: 'Number' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Budget')
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'In euros')
    await user.keyboard('{Control>}{Enter}{/Control}')
    const added = (onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.at(-1)!
    expect(added).toMatchObject({ type: 'number', key: 'budget', name: 'Budget', description: 'In euros' })
  })

  test('adding a second Content asks "Add a second content property?"', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const withBody = {
      ...PROJECT,
      propertyDefinitions: [...PROJECT.propertyDefinitions, propertyDef({ id: 'b', key: 'notes', type: 'blocks' })],
    }
    render(<AddPropertyMenu type={withBody} types={TYPES} onSave={onSave} />)
    await user.click(screen.getByRole('menuitem', { name: 'Content' }))
    expect(screen.getByText('Add a second content property?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add another' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.at(-1)!.type).toBe('blocks')
  })

  test('system items add the system property directly; a basic type disables the menu', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { unmount } = render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    await user.click(screen.getByRole('menuitem', { name: 'Created at' }))
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.at(-1)).toMatchObject({
      id: 'createdAt',
      key: 'createdAt',
      type: 'entity_createdAt',
    })
    unmount()
    render(<AddPropertyMenu type={PAGE} types={TYPES} onSave={onSave} />)
    expect(screen.getByText('The properties of basic types are fixed.')).toBeInTheDocument()
    for (const b of screen.getAllByRole('menuitem')) expect(b).toBeDisabled()
  })
})
