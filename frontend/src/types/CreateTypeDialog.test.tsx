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
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { THEME_COLORS } from '@/theme/palette'
import { CreateTypeDialog } from './CreateTypeDialog'
import { DeleteTypeDialog } from './DeleteTypeDialog'

const mocked = vi.mocked(api)

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  // The starter-set tests answer these two themselves: back to the shared mock's defaults.
  mocked.space.mockReset()
  mocked.spaceSetup.mockReset()
  useLinkIndex.setState({ types: [], objects: [], loaded: true })
  useSpaceInfo.setState({ space: null, loaded: false })
  document.querySelectorAll('.editor-toast').forEach((t) => t.remove())
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
    expect(headings).toEqual(['Personal', 'Use cases', 'Research', 'Media', 'Planning and reflection', 'IT operations', 'Starter sets'])
    // "Create your own" stays the first card.
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Create your own')
  })

  test('test IT operations is the last type group and collapsed until it is opened (M32)', async () => {
    withM32Gallery()
    const user = userEvent.setup()
    render(<CreateTypeDialog open />)
    const group = await screen.findByRole('group', { name: 'IT operations' })
    const toggle = within(group).getByRole('button', { name: 'IT operations' })
    expect(within(group).getByRole('heading', { name: 'IT operations' })).toContainElement(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Hosts/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Runbooks/ })).toBeNull()
    // Last of the type groups: after every other one, the unsectioned row included.
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
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Home life', 'Use cases', 'Media', 'Starter sets'])
  })

  // M32 (item 12): the two starting points the space dialog used to ask about, offered here.
  const toasts = () => [...document.querySelectorAll('.editor-toast')].map((t) => t.textContent)
  const NOTE_TYPE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
  const EVERYDAY = [
    typeDef({ id: 'person', name: 'Person', pluralName: 'People' }),
    typeDef({ id: 'meeting', name: 'Meeting', pluralName: 'Meetings' }),
    typeDef({ id: 'project', name: 'Project', pluralName: 'Projects' }),
    typeDef({ id: 'book', name: 'Book', pluralName: 'Books' }),
  ]

  test('test Starter sets is the last group: the Everyday set and the IT operations set, each with a line (M32)', async () => {
    withM32Gallery()
    render(<CreateTypeDialog open />)
    const group = await screen.findByRole('group', { name: 'Starter sets' })
    expect(within(group).getByRole('heading', { level: 3, name: 'Starter sets' })).toBeInTheDocument()
    const sets = within(group).getAllByRole('button')
    expect(sets.map((b) => b.textContent)).toEqual([
      'Everyday setComes with types for people, meetings, projects and books.',
      'IT operations setIncludes hosts, software, applications, runbooks and incidents.',
    ])
    // Under every type group, the collapsed IT operations included.
    const it = screen.getByRole('group', { name: 'IT operations' })
    expect(it.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Showing it adds nothing.
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
  })

  // Fix pass W2: a set is added only after a confirmation that names what it adds.
  // The gallery as the back end sends it for the two sets: the Everyday set's four types and the
  // IT operations group; nothing for Source (the IT set makes it; the gallery does not offer it).
  const setGallery = (have: readonly string[] = []): TypeTemplate[] =>
    [
      tpl('idea', 'personal', 'Idea', 'Ideas'),
      tpl('meeting', 'useCases', 'Meeting', 'Meetings'),
      tpl('person', 'useCases', 'Person', 'People'),
      tpl('project', 'useCases', 'Project', 'Projects'),
      tpl('book', 'media', 'Book', 'Books'),
      tpl('host', 'itOperations', 'Host', 'Hosts'),
      tpl('runbook', 'itOperations', 'Runbook', 'Runbooks'),
    ].map((t) => ({ ...t, added: have.includes(t.key) }))
  const withSetGallery = (have: readonly string[] = []) => {
    const gallery = vi.fn(async () => setGallery(have))
    ;(api as unknown as { typeGallery: () => Promise<TypeTemplate[]> }).typeGallery = gallery
    return gallery
  }
  const HOST = typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts' })
  const RUNBOOK = typeDef({ id: 'runbook', name: 'Runbook', pluralName: 'Runbooks' })
  const SOURCE = typeDef({ id: 'source', name: 'Source', pluralName: 'Sources' })
  const inSpace = (types: TypeDef[], work: { workOn?: boolean; workEnabled?: boolean | null } = {}) => {
    useLinkIndex.setState({ types, objects: [], loaded: true })
    useSpaceInfo.setState({ space: { name: 's', root: '/s', types, workOn: false, workEnabled: null, ...work }, loaded: true })
  }
  /** The set's card, once the gallery has loaded (the cards know what the space has from it). */
  const setCard = async (name: RegExp) => {
    await screen.findByRole('group', { name: 'Personal' })
    return within(screen.getByRole('group', { name: 'Starter sets' })).getByRole('button', { name })
  }

  test('test clicking a starter set asks first, naming the types the space lacks; Cancel adds nothing (W2)', async () => {
    const user = userEvent.setup()
    withSetGallery(['project'])
    inSpace([NOTE_TYPE, EVERYDAY[2]])
    render(<CreateTypeDialog open />)
    await user.click(await setCard(/Everyday set/))
    const confirm = await screen.findByRole('alertdialog', { name: 'Add the Everyday set?' })
    expect(confirm).toHaveTextContent('This adds 3 types (Person, Meeting, Book) to this space. Types you already have are left as they are.')
    // The Everyday set never touches the Work page.
    expect(confirm).not.toHaveTextContent('Work page')
    expect(within(confirm).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Add'])
    // Asking wrote nothing.
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
    expect(toasts()).toEqual([])
    // Back on the gallery, the set still offered.
    expect(await setCard(/Everyday set/)).toBeEnabled()
  })

  test('test the IT operations set says its types, templates and tags, and that the Work page is turned on (W2)', async () => {
    const user = userEvent.setup()
    withSetGallery(['person', 'meeting', 'project', 'book'])
    inSpace([NOTE_TYPE, ...EVERYDAY])
    render(<CreateTypeDialog open />)
    await user.click(await setCard(/IT operations set/))
    const confirm = await screen.findByRole('alertdialog', { name: 'Add the IT operations set?' })
    // Person, Meeting and Project are the set's too, but the space has them; Source is not in the gallery.
    expect(confirm).toHaveTextContent(
      'This adds 3 types (Host, Runbook, Source), their templates and tags to this space. Types you already have are left as they are.',
    )
    expect(confirm).toHaveTextContent('The Work page is turned on for this space.')
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
  })

  test('test the IT operations set does not promise the Work page when it is on already or was switched off by hand (W2)', async () => {
    const user = userEvent.setup()
    withSetGallery()
    // Switched off by hand: the set leaves the switch alone.
    inSpace([NOTE_TYPE], { workOn: false, workEnabled: false })
    const { unmount } = render(<CreateTypeDialog open />)
    await user.click(await setCard(/IT operations set/))
    let confirm = await screen.findByRole('alertdialog', { name: 'Add the IT operations set?' })
    expect(confirm).toHaveTextContent('This adds 6 types (Host, Runbook, Person, Meeting, Project, Source), their templates and tags to this space.')
    expect(confirm).not.toHaveTextContent('Work page')
    unmount()
    // Already on (here: read as on from the space's data, no switch stored).
    inSpace([NOTE_TYPE], { workOn: true, workEnabled: null })
    render(<CreateTypeDialog open />)
    await user.click(await setCard(/IT operations set/))
    confirm = await screen.findByRole('alertdialog', { name: 'Add the IT operations set?' })
    expect(confirm).not.toHaveTextContent('Work page')
  })

  test('test one type left to add is said in the singular (W2)', async () => {
    const user = userEvent.setup()
    withSetGallery(['person', 'meeting', 'project'])
    inSpace([NOTE_TYPE, EVERYDAY[0], EVERYDAY[1], EVERYDAY[2]])
    render(<CreateTypeDialog open />)
    await user.click(await setCard(/Everyday set/))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('This adds 1 type (Book) to this space. Types you already have are left as they are.')
  })

  test('test Add adds the Everyday set, says what was added and reads the gallery and types again (M32, W2)', async () => {
    const user = userEvent.setup()
    const gallery = withSetGallery(['project'])
    inSpace([NOTE_TYPE, EVERYDAY[2]])
    const after = { name: 's', root: '/s', types: [NOTE_TYPE, ...EVERYDAY], workOn: false }
    mocked.spaceSetup.mockResolvedValueOnce(after)
    // What the app reads again afterwards (the link index's own fetch of the space).
    mocked.space.mockResolvedValue(after)
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    render(<CreateTypeDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)
    await user.click(await setCard(/Everyday set/))
    expect(gallery).toHaveBeenCalledTimes(1)
    // The click alone adds nothing.
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mocked.spaceSetup).toHaveBeenCalledWith('basic'))
    expect(mocked.spaceSetup).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // Only the types the space did not have (it had Project already).
    await waitFor(() => expect(toasts()).toEqual(['Added: Person, Meeting, Book.']))
    await waitFor(() => expect(gallery).toHaveBeenCalledTimes(2))
    expect(useLinkIndex.getState().types.map((t) => t.id)).toEqual(['page', 'person', 'meeting', 'project', 'book'])
    expect(useSpaceInfo.getState().space?.types.map((t) => t.id)).toEqual(['page', 'person', 'meeting', 'project', 'book'])
    // The dialog stays on the gallery; no type's settings open.
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Starter sets' })).toBeInTheDocument()
    expect(mocked.createType).not.toHaveBeenCalled()
  })

  test('test a set whose types are all in the space reads "Added" and cannot be clicked (W2)', async () => {
    const user = userEvent.setup()
    withSetGallery(['person', 'meeting', 'project', 'book'])
    inSpace([NOTE_TYPE, ...EVERYDAY])
    render(<CreateTypeDialog open />)
    const everyday = await setCard(/Everyday set/)
    expect(everyday).toHaveTextContent('Everyday setAdded')
    expect(everyday).toBeDisabled()
    await user.click(everyday)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocked.spaceSetup).not.toHaveBeenCalled()
    // The IT operations set still has types to add: offered, not "Added".
    const it = await setCard(/IT operations set/)
    expect(it).toBeEnabled()
    expect(it).not.toHaveTextContent('Added')
  })

  test('test a set reads "Added" as soon as it was added, and the IT set says when it turned Work on (M32, W2)', async () => {
    const user = userEvent.setup()
    const gallery = withSetGallery(['person', 'meeting', 'project', 'book'])
    inSpace([NOTE_TYPE, ...EVERYDAY])
    const withIt = { name: 's', root: '/s', types: [NOTE_TYPE, ...EVERYDAY, HOST, RUNBOOK, SOURCE], workEnabled: true, workOn: true }
    mocked.spaceSetup.mockResolvedValueOnce(withIt)
    mocked.space.mockResolvedValue(withIt)
    render(<CreateTypeDialog open />)
    await user.click(await setCard(/IT operations set/))
    // The gallery the dialog reads again after the set: everything is in the space now.
    gallery.mockImplementation(async () => setGallery(['person', 'meeting', 'project', 'book', 'host', 'runbook']))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mocked.spaceSetup).toHaveBeenLastCalledWith('itops'))
    await waitFor(() => expect(toasts()).toContain('Added: Host, Runbook, Source. The Work page is now on for this space.'))
    expect(useSpaceInfo.getState().space?.workOn).toBe(true)
    await waitFor(async () => expect(await setCard(/IT operations set/)).toBeDisabled())
    expect(await setCard(/IT operations set/)).toHaveTextContent('IT operations setAdded')
  })

  test('test a set with a type the gallery does not list (Source) is not "Added" until the space has it (W2)', async () => {
    withSetGallery(['person', 'meeting', 'project', 'book', 'host', 'runbook'])
    inSpace([NOTE_TYPE, ...EVERYDAY, HOST, RUNBOOK])
    const user = userEvent.setup()
    render(<CreateTypeDialog open />)
    const it = await setCard(/IT operations set/)
    expect(it).toBeEnabled()
    await user.click(it)
    expect(await screen.findByRole('alertdialog')).toHaveTextContent("This adds 1 type (Source), the set's templates and tags to this space.")
  })

  test('test a set that cannot be added shows the error and no toast (M32)', async () => {
    const user = userEvent.setup()
    withSetGallery()
    inSpace([NOTE_TYPE])
    mocked.spaceSetup.mockRejectedValueOnce(new Error('This space is read-only.'))
    render(<CreateTypeDialog open />)
    await user.click(await setCard(/Everyday set/))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add' }))
    expect(await within(screen.getByRole('group', { name: 'Starter sets' })).findByRole('alert')).toHaveTextContent('This space is read-only.')
    expect(toasts()).toEqual([])
    // The set can be tried again.
    expect(await setCard(/Everyday set/)).toBeEnabled()
  })

  test('test while the gallery could not be read a set is still offered, in general words (W2)', async () => {
    const user = userEvent.setup()
    ;(api as unknown as { typeGallery: () => Promise<TypeTemplate[]> }).typeGallery = vi.fn(async () => {
      throw new Error('offline')
    })
    inSpace([NOTE_TYPE])
    render(<CreateTypeDialog open />)
    const card = within(await screen.findByRole('group', { name: 'Starter sets' })).getByRole('button', { name: /IT operations set/ })
    expect(card).toBeEnabled()
    await user.click(card)
    expect(await screen.findByRole('alertdialog', { name: 'Add the IT operations set?' })).toHaveTextContent(
      "This adds the set's types, their templates and tags to this space. Types you already have are left as they are.",
    )
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
    expect(screen.getByRole('heading', { name: 'Move this type to the Trash?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Moves the type, all its notes, its templates and the saved searches of only this type to the Trash; other saved searches stop using it. You can restore them from there for 30 days.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/can't be undone/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete type' }))
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
