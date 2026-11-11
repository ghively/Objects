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
  test('test AddPropertyMenu lists 24 items in order, hides existing Title, and Link to a type › Person creates an entity bound to person', async () => {
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

    await user.click(screen.getByRole('menuitem', { name: 'Link to a type' }))
    expect(screen.getByPlaceholderText('Search types')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Types' })
    expect(within(list).getByText('Person')).toBeInTheDocument()
    expect(within(list).getByText('Note')).toBeInTheDocument()
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

  // Fix pass W8: the menu works from the keyboard, and the default name gives way to what is typed.
  const highlighted = () => screen.getAllByRole('menuitem').filter((b) => b.getAttribute('data-active') === 'true').map((b) => b.getAttribute('aria-label'))

  test('test Enter in the search picks the first match, and typing replaces the selected default name (W8)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    // The search field has the focus when the menu opens.
    expect(screen.getByPlaceholderText('Search Properties')).toHaveFocus()
    await user.keyboard('Number')
    expect(items()).toEqual(['Number'])
    // Nothing is highlighted yet: Enter takes the first match.
    expect(highlighted()).toEqual([])
    await user.keyboard('{Enter}')
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(name).toHaveFocus()
    expect(name).toHaveValue('Number')
    // The whole default name is selected, so the next key replaces it.
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'Number'.length])
    await user.keyboard('Rating')
    expect(name).toHaveValue('Rating')
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.at(-1)).toMatchObject({ type: 'number', key: 'rating', name: 'Rating' })
  })

  test('test ArrowDown and ArrowUp move through the kinds and Enter picks the highlighted one (W8)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    const all = items()
    await user.keyboard('{ArrowDown}')
    expect(highlighted()).toEqual([all[0]])
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(highlighted()).toEqual([all[2]])
    await user.keyboard('{ArrowUp}')
    expect(highlighted()).toEqual([all[1]])
    // The focus never left the search field, so typing still filters.
    expect(screen.getByPlaceholderText('Search Properties')).toHaveFocus()
    // ArrowUp from the first stays on the first; ArrowDown from the last stays on the last.
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(highlighted()).toEqual([all[0]])
    await user.keyboard('{ArrowDown>40/}')
    expect(highlighted()).toEqual([all.at(-1)])
    // A new search starts from no highlight again.
    await user.keyboard('te')
    expect(highlighted()).toEqual([])
    expect(items().slice(0, 2)).toEqual(['Text', 'Content'])
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(highlighted()).toEqual(['Content'])
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Content')
  })

  test('test Enter with no match does nothing, and the keys work in the "Link to a type" list too (W8)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    await user.keyboard('zzzz{Enter}')
    expect(screen.getByPlaceholderText('Search Properties')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    await user.clear(screen.getByPlaceholderText('Search Properties'))
    await user.keyboard('Link to a type{Enter}')
    const search = screen.getByPlaceholderText('Search types')
    expect(search).toHaveFocus()
    // Note, Tag, Person and Project are offered (Task is not): the third, by the keys.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(name).toHaveValue('Person')
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'Person'.length])
    await user.keyboard('Owner{Enter}')
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.at(-1)).toMatchObject({ type: 'entity', name: 'Owner', options: { allowedTypes: ['person'] } })
  })

  test('test a system kind is added at once by Enter, and a basic type picks nothing (W8)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { unmount } = render(<AddPropertyMenu type={PROJECT} types={TYPES} onSave={onSave} />)
    await user.keyboard('Created at{Enter}')
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.at(-1)).toMatchObject({ type: 'entity_createdAt' })
    unmount()
    onSave.mockClear()
    render(<AddPropertyMenu type={PAGE} types={TYPES} onSave={onSave} />)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    expect(highlighted()).toEqual([])
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
