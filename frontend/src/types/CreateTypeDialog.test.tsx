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
    expect(screen.getByRole('heading', { name: 'Add a type' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create your own/ })).toBeInTheDocument()
    const media = await screen.findByRole('group', { name: 'Media' })
    expect(within(media).getByRole('button', { name: /Film/ })).toBeInTheDocument()
    const useCases = screen.getByRole('group', { name: 'Use cases' })
    expect(within(useCases).getByRole('button', { name: /Meeting/ })).toHaveTextContent('Added')
  })

  // M32 (item 12). The back end decides the sections and their order; `personal` is its new
  // section (the frontend names no Personal entry of its own).
  const tpl = (key: string, section: string | null, name: string, pluralName: string): TypeTemplate => ({
    ...GALLERY[1],
    key,
    section: section as TypeTemplate['section'],
    name,
    pluralName,
  })
  const M32_GALLERY: TypeTemplate[] = [
    tpl('idea', 'personal', 'Idea', 'Ideas'),
    tpl('recipe', 'personal', 'Recipe', 'Recipes'),
    GALLERY[0], // useCases
    // IT operations in the middle of the data: it still shows last.
    tpl('host', 'itOperations', 'Host', 'Hosts'),
    tpl('runbook', 'itOperations', 'Runbook', 'Runbooks'),
    tpl('definition', 'research', 'Definition', 'Definitions'),
    GALLERY[1], // media
    tpl('week', 'planningAndReflection', 'Week', 'Weeks'),
    tpl('thing', null, 'Thing', 'Things'),
  ]
  const withM32Gallery = () => {
    ;(api as unknown as { typeGallery: () => Promise<TypeTemplate[]> }).typeGallery = vi.fn(async () => M32_GALLERY)
  }

  test("test the gallery shows the data's sections in the data's order, Personal first (M32)", async () => {
    withM32Gallery()
    render(<CreateTypeDialog open />)
    const personal = await screen.findByRole('group', { name: 'Personal' })
    expect(within(personal).getByRole('button', { name: /Ideas/ })).toBeInTheDocument()
    expect(within(personal).getByRole('button', { name: /Recipes/ })).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Personal', 'Use cases', 'Research', 'Media', 'Planning and reflection', 'IT operations'])
    // "Create your own" stays the first card.
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Create your own')
  })

  test('test IT operations is last and collapsed until it is opened (M32)', async () => {
    withM32Gallery()
    const user = userEvent.setup()
    render(<CreateTypeDialog open />)
    const group = await screen.findByRole('group', { name: 'IT operations' })
    const toggle = within(group).getByRole('button', { name: 'IT operations' })
    expect(within(group).getByRole('heading', { name: 'IT operations' })).toContainElement(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Hosts/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Runbooks/ })).toBeNull()
    // Last: after every other group, the unsectioned row included.
    const things = screen.getByRole('button', { name: /Things/ })
    expect(things.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(group).getByRole('button', { name: /Hosts/ })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /Runbooks/ })).toBeInTheDocument()
    // A template of the group opens as any other.
    await user.click(within(group).getByRole('button', { name: /Hosts/ }))
    expect(screen.getByRole('heading', { name: 'Host' })).toBeInTheDocument()
    // Back in the gallery the group is still open (the dialog was not closed).
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'IT operations' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'IT operations' }))
    expect(screen.queryByRole('button', { name: /Hosts/ })).toBeNull()
  })

  test('test the IT operations fold is not remembered: a reopened gallery has it collapsed again (M32)', async () => {
    withM32Gallery()
    const user = userEvent.setup()
    const { rerender } = render(<CreateTypeDialog open />)
    const toggle = await screen.findByRole('button', { name: 'IT operations' })
    const stored = { ...localStorage }
    await user.click(toggle)
    expect(screen.getByRole('button', { name: /Hosts/ })).toBeInTheDocument()
    rerender(<CreateTypeDialog open={false} />)
    rerender(<CreateTypeDialog open />)
    expect(await screen.findByRole('button', { name: 'IT operations' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Hosts/ })).toBeNull()
    // Nothing was written anywhere for it.
    expect({ ...localStorage }).toEqual(stored)
  })

  test('test a section the frontend has no title for still shows, named from its key (M32)', async () => {
    ;(api as unknown as { typeGallery: () => Promise<TypeTemplate[]> }).typeGallery = vi.fn(async () => [
      tpl('pet', 'homeLife', 'Pet', 'Pets'),
      ...GALLERY,
    ])
    render(<CreateTypeDialog open />)
    const group = await screen.findByRole('group', { name: 'Home life' })
    expect(within(group).getByRole('button', { name: /Pets/ })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Home life', 'Use cases', 'Media'])
  })

  test('test the gallery offers no starter sets while no route applies one to an open space (M32)', async () => {
    withM32Gallery()
    render(<CreateTypeDialog open />)
    await screen.findByRole('group', { name: 'Personal' })
    expect(screen.queryByRole('group', { name: 'Starter sets' })).toBeNull()
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
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
    await user.click(screen.getByRole('button', { name: 'Create type' }))
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
    expect(screen.getByRole('heading', { name: 'Create your own type' })).toBeInTheDocument()
    expect(screen.getByText('Do I need a new type?')).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'Create type' })
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
