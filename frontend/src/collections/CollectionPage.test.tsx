import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Collection, Row } from '@/api/types'
import { collection, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { CollectionPage } from './CollectionPage'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1', propertyDefinitions: [TITLE] })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', propertyDefinitions: [TITLE] })

const mk = (path: string, title: string, over: Partial<Row['summary']> = {}) =>
  row({ summary: objectSummary({ path, type: 'server', title, collections: ['Tooling'], ...over }), version: `v-${title}` })
const ROWS = [mk('Servers/Alpha.md', 'Alpha'), mk('Servers/Beta.md', 'Beta', { id: 'beta-id' })]

const TOOLING = (over: Partial<Collection> = {}) =>
  collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'], revision: 'c1', ...over })

function setup(c: Collection = TOOLING(), rows: Row[] = ROWS) {
  mocked.collections.mockResolvedValue([c])
  mocked.rows.mockResolvedValue(rows)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.queries.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.createObject.mockResolvedValue({ path: 'Servers/New.md', version: 'v1' })
  mocked.saveCollection.mockImplementation(async (c: Collection) => ({
    collection: { ...c, revision: `${c.revision}+1` },
    rewritten: [],
    skipped: [],
  }))
  mocked.updateProperties.mockResolvedValue({ version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [] })
  useLinkIndex.setState({
    types: [SERVER, PAGE],
    objects: [...ROWS.map((r) => r.summary), objectSummary({ path: 'Servers/Gamma.md', type: 'server', title: 'Gamma' })],
    loaded: true,
  })
})

describe('CollectionPage', () => {
  test('test collection page All tab loads rows by collectionIds', async () => {
    setup()
    render(<CollectionPage id="tooling" />)
    expect(await screen.findByRole('textbox', { name: 'Collection name' })).toHaveValue('Tooling')
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ collectionIds: ['tooling'], preview: false }))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })

  test('test New in collection passes collections value and collection default template', async () => {
    const user = userEvent.setup()
    setup(TOOLING({ templates: { ids: [], defaultTemplateId: 'tpl-1' } }))
    render(<CollectionPage id="tooling" />)
    await user.click(await screen.findByRole('button', { name: 'New Server' }))
    await waitFor(() =>
      expect(mocked.createObject).toHaveBeenCalledWith('server', { values: { collections: ['Tooling'] }, templateId: 'tpl-1' }),
    )
  })

  test('test Add existing writes collections on picked object with its version', async () => {
    const user = userEvent.setup()
    setup()
    mocked.rows.mockImplementation(async (scope) =>
      scope?.paths ? [row({ summary: objectSummary({ path: 'Servers/Gamma.md', type: 'server', title: 'Gamma' }), version: 'vg' })] : ROWS,
    )
    render(<CollectionPage id="tooling" />)
    await user.click(await screen.findByRole('button', { name: 'Add existing' }))
    await user.click(await screen.findByRole('option', { name: /Gamma/ }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Servers/Gamma.md', { collections: ['Tooling'] }, 'vg'))
  })

  test('test rename saves with baseRevision and shows skipped count', async () => {
    const user = userEvent.setup()
    setup()
    mocked.saveCollection.mockResolvedValue({
      collection: TOOLING({ name: 'Gear', revision: 'c2' }),
      rewritten: [],
      skipped: [{ path: 'Servers/Alpha.md', reason: 'read-only' }],
    })
    render(<CollectionPage id="tooling" />)
    const name = await screen.findByRole('textbox', { name: 'Collection name' })
    await user.clear(name)
    await user.type(name, 'Gear{Enter}')
    await waitFor(() => expect(mocked.saveCollection).toHaveBeenCalled())
    const [saved, opts] = mocked.saveCollection.mock.calls[0]
    expect(saved.name).toBe('Gear')
    expect(opts).toEqual({ baseRevision: 'c1' })
    expect(await screen.findByTestId('collection-notice')).toHaveTextContent("1 object couldn't be updated and still list this collection.")
  })

  test('test collection Overview defaults to pinned and Add a section adds a query section', async () => {
    const user = userEvent.setup()
    setup()
    mocked.queries.mockResolvedValue([query({ id: 'q1', name: 'Open servers', revision: 'q' })])
    render(<CollectionPage id="tooling" />)
    await user.click(await screen.findByRole('tab', { name: 'Overview' }))
    const sections = await screen.findAllByTestId('overview-section')
    expect(sections.map((s) => s.getAttribute('data-section'))).toEqual(['pinned'])
    expect(within(sections[0]).getByText('Nothing pinned')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Customize Overview' }))
    await user.click(await screen.findByRole('button', { name: 'Add a section' }))
    await user.click(await screen.findByRole('button', { name: 'Add Open servers' }))
    await waitFor(
      () => {
        const saved = mocked.saveCollection.mock.calls.at(-1)?.[0]
        expect(saved?.views.dashboard.sections.map((s) => s.key)).toEqual(['pinned', 'query:q1'])
      },
      { timeout: 2000 },
    )
    expect(await screen.findByRole('tab', { name: 'Open servers' })).toBeInTheDocument()
  })

  test('test table refused when collection holds two types', async () => {
    const user = userEvent.setup()
    setup(TOOLING({ typeIds: ['server', 'page'] }))
    render(<CollectionPage id="tooling" />)
    await screen.findByTestId('data-view')
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    const items = (await screen.findAllByRole('menuitemcheckbox')).map((i) => i.textContent)
    expect(items).not.toContain('Table')
    expect(items).toContain('Kanban')
  })

  test('the row menu removes a row from the collection through the dialog with the row version', async () => {
    const user = userEvent.setup()
    setup()
    render(<CollectionPage id="tooling" />)
    const alpha = (await screen.findByText('Alpha')).closest('[data-path]') as HTMLElement
    await user.pointer({ keys: '[MouseRight]', target: alpha })
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from collection' }))
    expect(await screen.findByText('Remove from collection?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove from collection' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Servers/Alpha.md', { collections: [] }, 'v-Alpha'))
  })

  test('shows the empty state for an empty collection', async () => {
    setup(TOOLING(), [])
    render(<CollectionPage id="tooling" />)
    expect(await screen.findByText('This collection is empty. Create a record or add existing content.')).toBeInTheDocument()
  })
})
