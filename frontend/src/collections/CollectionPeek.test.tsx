// M31 item 7: a collection opens in a peek (catalog section 9): header (layout, Customize, search,
// `...`, a split New button, expand), the parent type's chip, the cards, a "+ New object" row and a
// stepper through the type's collections ("1 / 3"); expand opens the collection's tab page.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Collection, Row, Views } from '@/api/types'
import { collection, defaultViews, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useCollectionPeek, usePeek, useTabs } from '@/nav/tabs'
import { TypePage } from '@/types/TypePage'
import { useDefs } from '@/types/useDefinitions'
import { CollectionPeek, COLLECTION_PEEK_TEXT } from './CollectionPeek'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const PROJECT = typeDef({ id: 'project', name: 'Project', pluralName: 'Projects', revision: 'r1', propertyDefinitions: [TITLE] })

const mk = (path: string, title: string, collections: string[]) =>
  row({ summary: objectSummary({ path, type: 'project', title, collections }), version: `v-${title}` })
const ROWS: Row[] = [mk('Projects/Alpha.md', 'Alpha', ['Active']), mk('Projects/Beta.md', 'Beta', ['Active']), mk('Projects/Old.md', 'Old', ['Archive'])]

const ACTIVE = collection({ id: 'active', name: 'Active', typeIds: ['project'], revision: 'c1' })
const ARCHIVE = collection({ id: 'archive', name: 'Archive', typeIds: ['project'], revision: 'c1' })
const COLLECTIONS: Collection[] = [ACTIVE, ARCHIVE]

const dialog = () => screen.getByRole('dialog')

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useCollectionPeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue(COLLECTIONS)
  mocked.rows.mockImplementation(async (scope) => {
    const ids = scope?.collectionIds ?? []
    const names = COLLECTIONS.filter((c) => ids.includes(c.id)).map((c) => c.name)
    return ids.length > 0 ? ROWS.filter((r) => (r.summary.collections ?? []).some((n) => names.includes(n))) : ROWS
  })
  mocked.queries.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.createObject.mockResolvedValue({ path: 'Projects/New.md', version: 'v1' })
  mocked.saveCollection.mockImplementation(async (c: Collection) => ({ collection: { ...c, revision: `${c.revision}+1` }, rewritten: [], skipped: [] }))
  useLinkIndex.setState({ types: [PROJECT], objects: ROWS.map((r) => r.summary), loaded: true })
})

describe('CollectionPeek (M31)', () => {
  test('test collection peek shows the header, the parent type chip, the cards and the stepper', async () => {
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    useCollectionPeek.getState().peek('active', ['active', 'archive'], 'project')
    render(<CollectionPeek />)
    expect(await within(dialog()).findByRole('textbox', { name: 'Collection name' })).toHaveValue('Active')
    // The header: the view toolbar (layout, Customize), search, `...`, New, expand.
    const header = within(dialog()).getByTestId('collection-peek-header')
    expect(await within(header).findByRole('button', { name: 'Layout' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Customize view' })).toBeInTheDocument()
    expect(within(header).getByRole('searchbox', { name: 'Search title...' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'New Project' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: COLLECTION_PEEK_TEXT.expand })).toBeInTheDocument()
    // No Overview / All tabs in the peek.
    expect(within(dialog()).queryByRole('tab', { name: 'Overview' })).toBeNull()
    // Under the header, a chip of the parent type.
    expect(within(dialog()).getByTestId('collection-peek-type')).toHaveTextContent('Projects')
    // The cards.
    expect(await within(dialog()).findByText('Alpha')).toBeInTheDocument()
    expect(within(dialog()).getByText('Beta')).toBeInTheDocument()
    expect(within(dialog()).queryByText('Old')).toBeNull()
    expect(within(dialog()).getByRole('button', { name: COLLECTION_PEEK_TEXT.newObject })).toBeInTheDocument()
    expect(within(dialog()).getByTestId('collection-peek-stepper')).toHaveTextContent('1 / 2')
  })

  test('test collection peek stepper goes through the type collections', async () => {
    const user = userEvent.setup()
    useCollectionPeek.getState().peek('active', ['active', 'archive'], 'project')
    render(<CollectionPeek />)
    expect(await within(dialog()).findByText('Alpha')).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Previous' })).toBeDisabled()
    await user.click(within(dialog()).getByRole('button', { name: 'Next' }))
    expect(await within(dialog()).findByRole('textbox', { name: 'Collection name' })).toHaveValue('Archive')
    expect(await within(dialog()).findByText('Old')).toBeInTheDocument()
    expect(within(dialog()).getByTestId('collection-peek-stepper')).toHaveTextContent('2 / 2')
    expect(within(dialog()).getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  test('test collection peek expand opens the collection page and closes the peek', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    useCollectionPeek.getState().peek('active', ['active', 'archive'], 'project')
    render(<CollectionPeek />)
    await user.click(await within(dialog()).findByRole('button', { name: COLLECTION_PEEK_TEXT.expand }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'collection', id: 'active' })
    expect(useCollectionPeek.getState().id).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('test collection peek closes when the main view navigates', async () => {
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    useCollectionPeek.getState().peek('active', ['active'], 'project')
    render(<CollectionPeek />)
    expect(await within(dialog()).findByText('Alpha')).toBeInTheDocument()
    act(() => useTabs.getState().open({ kind: 'trash' }))
    expect(useCollectionPeek.getState().id).toBeNull()
  })

  test('test collection peek type chip opens the type page', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'trash' })
    useCollectionPeek.getState().peek('active', ['active'], 'project')
    render(<CollectionPeek />)
    await user.click(await within(dialog()).findByTestId('collection-peek-type'))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'type', typeId: 'project' })
    expect(useCollectionPeek.getState().id).toBeNull()
  })

  test('test collection peek New object row creates a member and opens it in the peek', async () => {
    const user = userEvent.setup()
    useCollectionPeek.getState().peek('active', ['active'], 'project')
    render(<CollectionPeek />)
    await user.click(await within(dialog()).findByRole('button', { name: COLLECTION_PEEK_TEXT.newObject }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalled())
    expect(mocked.createObject.mock.calls[0][0]).toBe('project')
    expect(mocked.createObject.mock.calls[0][1]).toMatchObject({ values: { collections: ['Active'] } })
    await waitFor(() => expect(usePeek.getState().path).toBe('Projects/New.md'))
    expect(useCollectionPeek.getState().id).toBe('active')
  })

  test('test a type overview collection tile opens the collection in the peek', async () => {
    const user = userEvent.setup()
    const v: Views = { ...defaultViews(), activeTab: 'overview', dashboard: { sections: [{ key: 'collections', collapsed: false }], removedSections: [] } }
    mocked.views.mockResolvedValue({ views: v, revision: 'r0' })
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    render(<TypePage type={PROJECT} />)
    const tiles = await screen.findAllByTestId('definition-card')
    expect(tiles.map((t) => t.textContent)).toEqual(['Active', 'Archive'])
    await user.click(tiles[1])
    expect(useCollectionPeek.getState()).toMatchObject({ id: 'archive', list: ['active', 'archive'], index: 1, typeId: 'project' })
    // The page stays where it was.
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'type', typeId: 'project' })
  })

  test('test a Ctrl-click on a collection tile still opens the page in a new tab', async () => {
    const user = userEvent.setup()
    const v: Views = { ...defaultViews(), activeTab: 'overview', dashboard: { sections: [{ key: 'collections', collapsed: false }], removedSections: [] } }
    mocked.views.mockResolvedValue({ views: v, revision: 'r0' })
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    render(<TypePage type={PROJECT} />)
    const tiles = await screen.findAllByTestId('definition-card')
    await user.keyboard('{Control>}')
    await user.click(tiles[0])
    await user.keyboard('{/Control}')
    expect(useCollectionPeek.getState().id).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'collection', id: 'active' })
    expect(useTabs.getState().tabs).toHaveLength(2)
  })
})
