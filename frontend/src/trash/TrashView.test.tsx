import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TrashItem } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useSettings } from '@/settings/useSettings'
import { typeDef } from '@/test/mockApi'
import { TrashView, trashPathLabel, trashTypeLabel } from './TrashView'

const mocked = vi.mocked(api)

const NOTE: TrashItem = {
  id: 'o1',
  kind: 'object',
  originalPath: 'Pages/Note.md',
  title: 'Note',
  type: 'Page',
  deletedAt: '2026-10-20T10:00:00.000Z',
}
const BOOK_TYPE: TrashItem = {
  id: 't1',
  kind: 'type',
  originalPath: '.object/types/book.json',
  title: 'Book',
  type: 'Book',
  deletedAt: '2026-10-21T10:00:00.000Z',
  objectCount: 3,
}
const BOOK_OBJECT: TrashItem = { ...NOTE, id: 'o2', originalPath: 'Books/Dune.md', title: 'Dune', type: 'Book', typeTrashId: 't1' }

let entries: TrashItem[]

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  entries = [NOTE, BOOK_TYPE, BOOK_OBJECT]
  mocked.trash.mockImplementation(async () => entries)
})

describe('TrashView', () => {
  test('test collection and query entries: own icon and subtitle, sole members hidden, counted in Empty Trash', async () => {
    const COLL: TrashItem = {
      id: 'c1',
      kind: 'collection',
      originalPath: '.object/collections/tooling.json',
      title: 'Tooling',
      type: '',
      deletedAt: '2026-10-22T10:00:00.000Z',
      objectCount: 2,
      collectionId: 'tooling',
      name: 'Tooling',
    }
    const MEMBER: TrashItem = { ...NOTE, id: 'o3', title: 'Atlas', originalPath: 'Servers/Atlas.md', collectionTrashId: 'c1' }
    const QUERY: TrashItem = {
      id: 'q1',
      kind: 'query',
      originalPath: '.object/queries/open.json',
      title: 'Open',
      type: '',
      deletedAt: '2026-10-23T10:00:00.000Z',
      queryId: 'open',
      name: 'Open',
    }
    entries = [COLL, MEMBER, QUERY]
    const user = userEvent.setup()
    render(<TrashView />)
    const list = await screen.findByRole('list', { name: 'Trash' })
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Tooling', 'Open'])
    const coll = within(list).getByRole('listitem', { name: 'Tooling' })
    expect(coll).toHaveTextContent('Collection · 2 notes')
    expect(coll).not.toHaveTextContent('.object')
    // Icons render once their bundled set has loaded.
    await waitFor(() => expect(coll.querySelector('[data-icon="ph-cards-three"]')).not.toBeNull())
    await waitFor(() =>
      expect(within(list).getByRole('listitem', { name: 'Open' }).querySelector('[data-icon="ph-list-magnifying-glass"]')).not.toBeNull(),
    )
    expect(within(list).getByRole('listitem', { name: 'Open' })).toHaveTextContent(/^OpenSaved search · /)
    await user.click(screen.getByRole('button', { name: 'Empty Trash' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete all 4 entries in the Trash for good?')
    expect(dialog).not.toHaveTextContent('(s)')
  })

  test('lists notes and types (a type with its note count), with the 30-day info', async () => {
    render(<TrashView />)
    const list = await screen.findByRole('list', { name: 'Trash' })
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Note', 'Book'])
    expect(within(list).getByRole('listitem', { name: 'Book' })).toHaveTextContent('Type · 3 notes')
    const info = screen.getByText(/30 days/)
    expect(info).not.toHaveTextContent(/Windows/)
    expect(info).toHaveTextContent('Notes and types are kept in the Trash for 30 days')
    expect(info).toHaveTextContent('Types and collections cannot be restored completely.')
    expect(info).not.toHaveTextContent(/object type|Objects/)
  })

  test('test Empty Trash requires typing "Delete"', async () => {
    const user = userEvent.setup()
    render(<TrashView />)
    await screen.findByRole('list', { name: 'Trash' })
    await user.click(screen.getByRole('button', { name: 'Empty Trash' }))
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Empty Trash' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Enter "Delete" to go ahead' }), 'delete')
    expect(confirm).toBeDisabled()
    await user.clear(within(dialog).getByRole('textbox'))
    await user.type(within(dialog).getByRole('textbox'), 'Delete')
    expect(confirm).toBeEnabled()
    entries = []
    await user.click(confirm)
    await waitFor(() => expect(mocked.emptyTrash).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument()
  })

  test('test restoring a type entry calls restore and lists the type again', async () => {
    const user = userEvent.setup()
    mocked.restore.mockImplementation(async () => {
      entries = [NOTE]
      return { paths: ['Books/Dune.md'], typeIds: ['book'] }
    })
    mocked.space.mockResolvedValue({
      name: 's',
      root: '/s',
      types: [{ id: 'book', name: 'Book' } as never],
    })
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Book' })
    await user.click(within(row).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(mocked.restore).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Book' })).not.toBeInTheDocument())
    // The index reloads, so the sidebar lists the type again.
    await waitFor(() => expect(useLinkIndex.getState().types.map((t) => t.id)).toContain('book'))
  })

  test('Delete permanently purges one entry only after confirming', async () => {
    const user = userEvent.setup()
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Note' })
    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete permanently?' })
    expect(dialog).toHaveTextContent("Delete 1 note for good? You won't be able to get it back.")
    expect(dialog).not.toHaveTextContent('(s)')
    expect(mocked.purge).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocked.purge).not.toHaveBeenCalled()

    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const again = await screen.findByRole('alertdialog', { name: 'Delete permanently?' })
    await user.click(within(again).getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(mocked.purge).toHaveBeenCalledWith('o1'))
  })

  test('a type row counts the type and its notes', async () => {
    const user = userEvent.setup()
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Book' })
    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete permanently?' })
    expect(dialog).toHaveTextContent('Delete this type and its 3 notes for good?')
  })

  test('purging a saved search names it, not "note(s)"', async () => {
    entries = [
      { id: 'q1', kind: 'query', originalPath: '.object/queries/open.json', title: 'Open', type: '', deletedAt: NOTE.deletedAt, queryId: 'open', name: 'Open' },
    ]
    const user = userEvent.setup()
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Open' })
    await user.click(within(row).getByRole('button', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete permanently?' })
    expect(dialog).toHaveTextContent('Delete this saved search for good?')
    expect(dialog).not.toHaveTextContent('(s)')
  })
})

// M32 (notes first): the Trash names a type as the rest of the screen does.
describe('TrashView type names (M32)', () => {
  const DAILY: TrashItem = {
    id: 'o9',
    kind: 'object',
    originalPath: 'DailyNotes/2026-11-10.md',
    title: '2026-11-10',
    type: 'DailyNote',
    deletedAt: '2026-11-11T10:00:00.000Z',
  }

  test('test a deleted daily note reads Daily note and Daily notes, not DailyNotes', async () => {
    useLinkIndex.setState({
      types: [
        typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true }),
        typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true }),
      ],
    })
    entries = [DAILY, NOTE]
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: '2026-11-10' })
    expect(row).toHaveTextContent('Daily note · Daily notes/2026-11-10.md · ')
    expect(row).not.toHaveTextContent(/DailyNotes?/)
    // The path as it is on disk stays one hover away.
    expect(within(row).getByTitle('DailyNotes/2026-11-10.md')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Note' })).toHaveTextContent('Note · Notes/Note.md · ')
  })

  test('test the built-in names read the same when the type itself is gone', () => {
    expect(trashTypeLabel('DailyNote', [])).toBe('Daily note')
    expect(trashPathLabel('DailyNotes/2026-11-10.md', [])).toBe('Daily notes/2026-11-10.md')
    expect(trashTypeLabel('Page', [])).toBe('Note')
    expect(trashPathLabel('Pages/Sub/Plan.md', [])).toBe('Notes/Sub/Plan.md')
    // Any other type and folder is shown as it is stored.
    expect(trashTypeLabel('Book', [])).toBe('Book')
    expect(trashPathLabel('Books/Dune.md', [])).toBe('Books/Dune.md')
    expect(trashPathLabel('loose.md', [])).toBe('loose.md')
  })

  test('test a type the user renamed keeps their name and folder', () => {
    const renamed = [typeDef({ id: 'page', name: 'Doc', pluralName: 'Docs', basic: true })]
    expect(trashTypeLabel('Doc', renamed)).toBe('Doc')
    expect(trashPathLabel('Docs/Plan.md', renamed)).toBe('Docs/Plan.md')
    // A leftover "Pages" folder is not the renamed type's: shown as it is.
    expect(trashPathLabel('Pages/Old.md', renamed)).toBe('Pages/Old.md')
    expect(trashTypeLabel('Page', renamed)).toBe('Page')
  })

  // M32 fix pass (W16): the server names a deleted note's type by its id ("recipe"), and the row
  // showed that id. It shows the type's name.
  test('test a deleted note is named by its type\'s name, not the type\'s id (W16)', async () => {
    useLinkIndex.setState({
      types: [
        typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true }),
        typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true }),
        typeDef({ id: 'recipe', name: 'Recipe', pluralName: 'Recipes' }),
        typeDef({ id: 'journalEntry', name: 'Journal entry', pluralName: 'Journal entries' }),
      ],
    })
    entries = [
      { ...NOTE, id: 'r1', originalPath: 'Recipes/Lentil soup.md', title: 'Lentil soup', type: 'recipe' },
      { ...NOTE, id: 'j1', originalPath: 'Journal entries/Monday.md', title: 'Monday', type: 'journalEntry' },
      { ...NOTE, id: 'p1', originalPath: 'Pages/Plan.md', title: 'Plan', type: 'page' },
      { ...DAILY, type: 'dailynote' },
    ]
    render(<TrashView />)
    const soup = await screen.findByRole('listitem', { name: 'Lentil soup' })
    expect(soup).toHaveTextContent('Recipe · Recipes/Lentil soup.md · ')
    expect(soup).not.toHaveTextContent('recipe ·')
    expect(screen.getByRole('listitem', { name: 'Monday' })).toHaveTextContent('Journal entry · Journal entries/Monday.md · ')
    expect(screen.getByRole('listitem', { name: 'Plan' })).toHaveTextContent('Note · Notes/Plan.md · ')
    expect(screen.getByRole('listitem', { name: '2026-11-10' })).toHaveTextContent('Daily note · Daily notes/2026-11-10.md · ')
  })

  test('test a type id reads as the type\'s name; a type that is gone keeps what it showed (W16)', () => {
    const types = [typeDef({ id: 'recipe', name: 'Recipe', pluralName: 'Recipes' }), typeDef({ id: 'page', name: 'Doc', pluralName: 'Docs', basic: true })]
    expect(trashTypeLabel('recipe', types)).toBe('Recipe')
    // The built-in Page under the user's own name: theirs.
    expect(trashTypeLabel('page', types)).toBe('Doc')
    // The built-in types by id when the type itself is gone, as by name.
    expect(trashTypeLabel('page', [])).toBe('Note')
    expect(trashTypeLabel('dailynote', [])).toBe('Daily note')
    // Any other type that no longer exists: what the entry holds, as before.
    expect(trashTypeLabel('recipe', [])).toBe('recipe')
    expect(trashTypeLabel('', types)).toBe('')
  })

  test('test a trashed built-in type is listed by the name the screen gives it', async () => {
    entries = [
      { id: 't9', kind: 'type', originalPath: '.object/types/page.json', title: 'Page', type: 'page', deletedAt: NOTE.deletedAt, objectCount: 2 },
    ]
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Note' })
    expect(row).toHaveTextContent('Type · 2 notes')
  })
})

describe('TrashView times', () => {
  test('shows when an entry was deleted in the Time zone setting', async () => {
    const settings = useSettings.getState().settings
    useSettings.setState({ settings: { ...settings, timeZone: 'Pacific/Auckland' } })
    try {
      render(<TrashView />)
      const list = await screen.findByRole('list', { name: 'Trash' })
      // 2026-10-20T10:00Z is 23:00 on 20 Oct in Auckland.
      expect(within(list).getByRole('listitem', { name: 'Note' })).toHaveTextContent(/Oct 20, 2026, 11:00\sPM/)
    } finally {
      useSettings.setState({ settings })
    }
  })

  test('an automation entry shows its name, "Automation" and restores by id', async () => {
    const RULE: TrashItem = {
      id: 'a1',
      kind: 'automation',
      originalPath: '.object/automations/01JRULE.json',
      title: '',
      type: '',
      deletedAt: '2026-10-24T10:00:00.000Z',
      automationId: '01JRULE',
      name: 'Stamp done',
    }
    entries = [RULE]
    const user = userEvent.setup()
    render(<TrashView />)
    const row = await screen.findByRole('listitem', { name: 'Stamp done' })
    expect(row).toHaveTextContent('Automation · ')
    expect(row).not.toHaveTextContent('.object')
    await waitFor(() => expect(row.querySelector('[data-icon="ph-lightning"]')).not.toBeNull())
    await user.click(within(row).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(mocked.restore).toHaveBeenCalledWith('a1'))
  })
})
