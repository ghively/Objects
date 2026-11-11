import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Query, QueryDefinition, Row } from '@/api/types'
import { collection, defaultViews, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { QueryPage } from './QueryPage'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1', propertyDefinitions: [TITLE] })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', propertyDefinitions: [TITLE] })

const mk = (path: string, title: string, over: Partial<Row['summary']> = {}) =>
  row({ summary: objectSummary({ path, type: 'server', title, ...over }), version: `v-${title}` })
const ROWS = [mk('Servers/Alpha.md', 'Alpha'), mk('Servers/Beta.md', 'Beta')]

const emptyDef = (over: Partial<QueryDefinition> = {}): QueryDefinition => ({
  types: [],
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: null,
  ...over,
})
const Q = (over: Partial<Query> = {}) =>
  query({ id: 'q1', name: 'Open servers', revision: 'q1r', definition: emptyDef({ types: [{ id: 'server' }] }), ...over })

function setup(q: Query = Q(), rows: Row[] = ROWS) {
  mocked.queries.mockResolvedValue([q])
  mocked.rows.mockResolvedValue(rows)
}

const lastSaved = () => mocked.saveQuery.mock.calls.at(-1)

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.views.mockResolvedValue({ views: defaultViews(), revision: 'v0' })
  mocked.saveViews.mockResolvedValue({ revision: 'v1' })
  mocked.saveQuery.mockImplementation(async (q: Query) => ({ query: { ...q, revision: `${q.revision}+1` } }))
  mocked.saveCollection.mockImplementation(async (c) => ({ collection: { ...c, revision: `${c.revision}+1` }, rewritten: [], skipped: [] }))
  useLinkIndex.setState({
    types: [SERVER, PAGE],
    objects: ROWS.map((r) => r.summary),
    loaded: true,
  })
})

describe('QueryPage', () => {
  test('test isQueryReady false for empty definition shows Saved search isn’t ready', async () => {
    setup(Q({ definition: emptyDef() }))
    render(<QueryPage id="q1" />)
    expect(await screen.findByText('Saved search isn’t ready')).toBeInTheDocument()
    expect(
      screen.getByText('The draft is kept, but it lists nothing until it has a search term, a tag or a type.'),
    ).toBeInTheDocument()
  })

  test('shows the results, and "No content found" when ready with none', async () => {
    setup()
    const { unmount } = render(<QueryPage id="q1" />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['server'], preview: false }))
    unmount()
    setup(Q(), [])
    render(<QueryPage id="q1" />)
    expect(await screen.findByText('No content found')).toBeInTheDocument()
  })

  test('test filter edits save definition with baseRevision; layout saves view.viewDefinition only', async () => {
    const user = userEvent.setup()
    setup()
    render(<QueryPage id="q1" />)
    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(await screen.findByRole('button', { name: '+ Filter' }))
    await waitFor(() => expect(mocked.saveQuery).toHaveBeenCalled(), { timeout: 2000 })
    const [saved, opts] = lastSaved()!
    expect(opts).toEqual({ baseRevision: 'q1r' })
    expect(saved.definition.filterGroup.elements).toHaveLength(1)
    expect(saved.view.viewDefinition.dataViewLayout).toBe('list')

    mocked.saveQuery.mockClear()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Kanban' }))
    await waitFor(() => expect(mocked.saveQuery).toHaveBeenCalled(), { timeout: 2000 })
    const [again, opts2] = lastSaved()!
    expect(opts2).toEqual({ baseRevision: 'q1r+1' })
    expect(again.view.viewDefinition.dataViewLayout).toBe('kanban')
    expect(again.definition.filterGroup.elements).toHaveLength(1)
  })

  test('test excludeTags and excluded types ignored without search or tag; hints shown', async () => {
    const user = userEvent.setup()
    setup(Q({ definition: emptyDef() }))
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit saved search' }))
    expect(screen.getByText('To exclude tags, first add a search term or include a tag.')).toBeInTheDocument()
    expect(screen.getByText('Excluding types needs a search term or a tag first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave out tags or backlinks' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Exclude types/ })).toBeDisabled()
  })

  test('with a type selected the exclude control says it has no effect', async () => {
    const user = userEvent.setup()
    setup(Q({ definition: emptyDef({ types: [{ id: 'server' }], search: { searchTerms: [{ text: 'alp' }], searchMode: 'auto' } }) }))
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit saved search' }))
    expect(screen.getByText('Ignored while particular types are picked.')).toBeInTheDocument()
    // While searching, the toolbar and the builder say filters and sorts pause.
    expect(screen.getAllByText('Sorting and property filters are off during a search.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('title', 'Sorting and property filters are off during a search.')
  })

  test('test builder All clears types; Exclude types writes excludeTypeIds', async () => {
    const user = userEvent.setup()
    setup(Q({ definition: emptyDef({ types: [{ id: 'server' }], search: { searchTerms: [{ text: 'alp' }], searchMode: 'auto' } }) }))
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit saved search' }))
    await user.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(mocked.saveQuery).toHaveBeenCalled(), { timeout: 2000 })
    expect(lastSaved()![0].definition.types).toEqual([])

    mocked.saveQuery.mockClear()
    await user.click(screen.getByRole('button', { name: /Exclude types/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Note' }))
    await waitFor(() => expect(mocked.saveQuery).toHaveBeenCalled(), { timeout: 2000 })
    expect(lastSaved()![0].definition.excludeTypeIds).toEqual(['page'])
  })

  test('the builder adds a search term, a mode and a limit', async () => {
    const user = userEvent.setup()
    setup()
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit saved search' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'x{Enter}')
    expect(mocked.saveQuery).not.toHaveBeenCalled()
    expect(screen.getByText('Type 2 or more characters')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Search' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'plan{Enter}')
    expect(await screen.findByText('With more than one term, a result needs to match only one.')).toBeInTheDocument()
    // Exact and Semantic are hidden until full-text search exists (Q-1).
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Auto', 'Title'])
    await user.click(screen.getByRole('radio', { name: 'Title' }))

    await user.click(screen.getByRole('button', { name: 'Limit' }))
    const items = (await screen.findAllByRole('menuitemcheckbox')).map((i) => i.textContent)
    expect(items).toEqual([
      'No limit',
      ...[1, 3, 5, 10, 25, 50].map((n) => `first ${n}`),
      ...[1, 3, 5, 10, 25, 50].map((n) => `random ${n}`),
    ])
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'random 5' }))
    await waitFor(
      () => {
        const d = lastSaved()![0].definition
        expect(d.limit).toEqual({ size: 5, random: true })
        expect(d.search).toEqual({ searchTerms: [{ text: 'plan' }], searchMode: 'title' })
      },
      { timeout: 2000 },
    )
  })

  test('a saved query in a hidden mode (Exact, Semantic) shows Auto; editing it writes Auto (Q-1)', async () => {
    const user = userEvent.setup()
    setup(Q({ definition: emptyDef({ search: { searchTerms: [{ text: 'alp' }], searchMode: 'semantic' } }) }))
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit saved search' }))
    expect(screen.queryByRole('radio', { name: 'Semantic' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Exact' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    expect(mocked.saveQuery).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'beta{Enter}')
    await waitFor(() => expect(mocked.saveQuery).toHaveBeenCalled(), { timeout: 2000 })
    expect(lastSaved()![0].definition.search).toEqual({ searchTerms: [{ text: 'alp' }, { text: 'beta' }], searchMode: 'auto' })
  })

  test('test Pin to type adds query section to type views', async () => {
    const user = userEvent.setup()
    setup()
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to type' }))
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalled())
    const [typeId, views, base] = mocked.saveViews.mock.calls[0]
    expect(typeId).toBe('server')
    expect(base).toBe('v0')
    expect(views.dashboard.sections.map((s) => s.key)).toContain('query:q1')
  })

  test('Unpin from type drops the section when the type already shows the query', async () => {
    const user = userEvent.setup()
    setup()
    const v = defaultViews()
    v.dashboard.sections = [{ key: 'query:q1', collapsed: false }]
    mocked.views.mockResolvedValue({ views: v, revision: 'v0' })
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin from type' }))
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalled())
    expect(mocked.saveViews.mock.calls[0][1].dashboard.sections).toEqual([])
  })

  test('test Pin to dashboard adds query section to the chosen collection', async () => {
    const user = userEvent.setup()
    setup()
    mocked.collections.mockResolvedValue([
      collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'], revision: 'c1' }),
      collection({ id: 'docs', name: 'Docs', typeIds: ['page'], revision: 'c2' }),
    ])
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to dashboard' }))
    const sub = await screen.findAllByRole('menuitemcheckbox')
    // Only the collections that hold one of the query's types are offered.
    expect(sub.map((i) => i.textContent)).toEqual(['Tooling'])
    sub[0].focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocked.saveCollection).toHaveBeenCalled())
    const [saved, opts] = mocked.saveCollection.mock.calls[0]
    expect(saved.id).toBe('tooling')
    expect(opts).toEqual({ baseRevision: 'c1' })
    expect(saved.views.dashboard.sections.map((s) => s.key)).toEqual(['pinned', 'query:q1'])
  })

  test('the title is automatic until edited; editing sets titleIsCustom', async () => {
    const user = userEvent.setup()
    setup(Q({ name: '', titleIsCustom: false }))
    render(<QueryPage id="q1" />)
    const name = await screen.findByRole('textbox', { name: 'Saved search name' })
    expect(name).toHaveValue('Servers')
    await user.clear(name)
    await user.type(name, 'My servers{Enter}')
    await waitFor(() => expect(mocked.saveQuery).toHaveBeenCalled(), { timeout: 2000 })
    expect(lastSaved()![0]).toMatchObject({ name: 'My servers', titleIsCustom: true })
  })

  test('Delete removes the query and opens the Queries page', async () => {
    const user = userEvent.setup()
    setup()
    mocked.deleteQuery.mockResolvedValue({ trashId: 't1' })
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(mocked.deleteQuery).toHaveBeenCalledWith('q1'))
    await waitFor(() => expect(useTabs.getState().tabs.at(-1)?.history.at(-1)).toEqual({ kind: 'queries' }))
    expect(within(document.body).queryByText('Unknown saved search')).toBeNull()
  })
})
