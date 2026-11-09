import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef, TypeTemplate } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { THEME_COLORS } from '@/theme/palette'
import { CreateTypeDialog } from './CreateTypeDialog'
import { DeleteTypeDialog } from './DeleteTypeDialog'

const mocked = vi.mocked(api)

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useLinkIndex.setState({ types: [], objects: [], loaded: true })
})

const GALLERY: TypeTemplate[] = [
  {
    key: 'meeting',
    section: 'useCases',
    name: 'Meeting',
    pluralName: 'Meetings',
    description: 'Notes from a meeting: who came, when, and what was said.',
    icon: { type: 'iconify', val: 'ph-users-three' },
    color: 'orange',
    properties: [{ name: 'Date', type: 'datetime' }, { name: 'Notes', type: 'blocks' }],
    added: true,
  },
  {
    key: 'film',
    section: 'media',
    name: 'Film',
    pluralName: 'Films',
    description: 'Films you have seen, with director, genre and a rating.',
    icon: { type: 'iconify', val: 'ph-film-strip' },
    color: 'red',
    properties: [
      { name: 'Genre', type: 'label' },
      { name: 'Notes', type: 'blocks' },
    ],
    added: false,
  },
]

function withGallery() {
  ;(api as unknown as { typeGallery: () => Promise<TypeTemplate[]> }).typeGallery = vi.fn(async () => GALLERY)
}

describe('CreateTypeDialog gallery (item 21)', () => {
  test('lists the templates under their sections; "Added" for one the space has', async () => {
    withGallery()
    render(<CreateTypeDialog open />)
    expect(screen.getByRole('heading', { name: 'Add new object type' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create your own/ })).toBeInTheDocument()
    const media = await screen.findByRole('group', { name: 'Media' })
    expect(within(media).getByRole('button', { name: /Film/ })).toBeInTheDocument()
    const useCases = screen.getByRole('group', { name: 'Use cases' })
    expect(within(useCases).getByRole('button', { name: /Meeting/ })).toHaveTextContent('Added')
  })

  test('a template shows its properties and creates the type from it', async () => {
    withGallery()
    const user = userEvent.setup()
    const onCreated = vi.fn()
    mocked.createType.mockImplementationOnce(async () => typeDef({ id: 'film', name: 'Film' }))
    render(<CreateTypeDialog open onCreated={onCreated} />)
    await user.click(await screen.findByRole('button', { name: /Film/ }))
    expect(screen.getByRole('heading', { name: 'Film' })).toBeInTheDocument()
    expect(screen.getByText('Films you have seen, with director, genre and a rating.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Properties' })).toHaveTextContent('Genre')
    await user.click(screen.getByRole('button', { name: 'Create object type' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(mocked.createType.mock.calls[0][0]).toMatchObject({ template: 'film' })
    expect(useLinkIndex.getState().types.map((t) => t.id)).toEqual(['film'])
  })

  test('an added template cannot be created again', async () => {
    withGallery()
    const user = userEvent.setup()
    render(<CreateTypeDialog open />)
    await user.click(await screen.findByRole('button', { name: /Meeting/ }))
    expect(screen.getByRole('button', { name: 'Added' })).toBeDisabled()
  })
})

describe('CreateTypeDialog', () => {
  test('test create button disabled until both fields filled; submit calls createType then opens typeSettings tab', async () => {
    withGallery()
    const user = userEvent.setup()
    const onCreated = vi.fn((t: TypeDef) => useTabs.getState().open({ kind: 'typeSettings', typeId: t.id }))
    render(<CreateTypeDialog open onCreated={onCreated} />)
    await user.click(screen.getByRole('button', { name: /Create your own/ }))
    expect(screen.getByRole('heading', { name: 'Create your object type' })).toBeInTheDocument()
    expect(screen.getByText('Do I need a new type?')).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'Create object type' })
    expect(create).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Book')
    expect(create).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Plural of name' }), '   ')
    expect(create).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Plural of name' }))
    await user.type(screen.getByRole('textbox', { name: 'Plural of name' }), 'Books')
    expect(create).toBeEnabled()
    await user.click(create)

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(mocked.createType).toHaveBeenCalledTimes(1)
    const input = mocked.createType.mock.calls[0][0]
    expect(input).toMatchObject({ name: 'Book', pluralName: 'Books', icon: { type: 'iconify', val: 'ph-cube' } })
    expect(THEME_COLORS).toContain(input.color)
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 'book', name: 'Book' })
    // The new type is known at once, and its settings are open.
    expect(useLinkIndex.getState().types.map((t) => t.id)).toEqual(['book'])
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'typeSettings', typeId: 'book' })
  })
})

describe('DeleteTypeDialog', () => {
  test('test delete type dialog says it moves to the Trash and calls deleteType with confirm', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const onOpenChange = vi.fn()
    render(<DeleteTypeDialog type={typeDef({ id: 'book', name: 'Book' })} open onOpenChange={onOpenChange} onDeleted={onDeleted} />)
    expect(screen.getByRole('heading', { name: 'Move this object type to the Trash?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Moves the object type, all its objects, its templates and the saved queries of only this type to the Trash; other queries stop using it. You can restore them from there for 30 days.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/can't be undone/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete object type' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('trash-type-1'))
    expect(mocked.deleteType).toHaveBeenCalledWith('book', { confirm: true })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('Cancel deletes nothing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<DeleteTypeDialog type={typeDef({ id: 'book' })} open onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocked.deleteType).not.toHaveBeenCalled()
  })
})
