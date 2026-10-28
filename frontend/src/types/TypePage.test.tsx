import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, Views } from '@/api/types'
import { collection, defaultViews, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { useRecent } from '@/nav/recent'
import { TypePage } from './TypePage'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const TAGS = propertyDef({ id: 'tags', key: 'tags', name: 'Tags', type: 'entity_tags' })
const DONE = propertyDef({ id: 'done', key: 'done', name: 'Done', type: 'boolean' })
const TASK = typeDef({
  id: 'task',
  name: 'Task',
  pluralName: 'Tasks',
  revision: 'r1',
  propertyDefinitions: [TITLE, TAGS, DONE],
})

const mk = (path: string, title: string, over: Partial<Row['summary']> = {}) =>
  row({ summary: objectSummary({ path, type: 'task', title, ...over }) })
const ROWS = [mk('Tasks/Alpha.md', 'Alpha'), mk('Tasks/Alphabet.md', 'Alphabet'), mk('Tasks/Beta.md', 'Beta'), mk('Tasks/Gamma.md', 'Gamma')]

const SECTIONS = ['recentlyAccessed', 'collections', 'queries', 'inNoCollection', 'notTagged'] as const
function views(over: Partial<Views> = {}, keys: readonly string[] = SECTIONS, removed: string[] = []): Views {
  const v = defaultViews()
  return {
    ...v,
    ...over,
    dashboard: { sections: keys.map((key) => ({ key: key as never, collapsed: false })), removedSections: removed },
  }
}

function load(v: Views, revision = 'r0') {
  mocked.views.mockResolvedValue({ views: v, revision })
}

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent)
const lastSaved = () => {
  const calls = mocked.saveViews.mock.calls
  return calls[calls.length - 1]
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useRecent.getState().clear()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.views.mockResolvedValue({ views: views(), revision: 'r0' })
  mocked.saveViews.mockResolvedValue({ revision: 'r1' })
  mocked.rows.mockResolvedValue(ROWS)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.createObject.mockResolvedValue({ path: 'Tasks/New.md', version: 'v1' })
  mocked.createQuery.mockImplementation(async (init) => query({ ...init, id: 'new-query', name: init?.name ?? '', revision: 'r1' }))
  mocked.onChange.mockReturnValue(() => undefined)
  useLinkIndex.setState({ types: [TASK], objects: ROWS.map((r) => r.summary), loaded: true })
})

describe('TypePage', () => {
  test('test tabs Overview and All persist activeTab via saveViews', async () => {
    const user = userEvent.setup()
    load(views({ activeTab: 'all' }))
    render(<TypePage type={TASK} />)
    expect(await screen.findByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalled())
    const [typeId, saved, base] = lastSaved()
    expect(typeId).toBe('task')
    expect(saved.activeTab).toBe('overview')
    expect(base).toBe('r0')
  })

  test('the header has the plural name, a search button that opens the field, and the New button', async () => {
    const user = userEvent.setup()
    render(<TypePage type={TASK} />)
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search title...')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByPlaceholderText('Search title...')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'New Task' })).toBeInTheDocument()
  })

  test('test All tab renders DataView with full layouts including kanban and no gallery', async () => {
    const user = userEvent.setup()
    render(<TypePage type={TASK} />)
    await screen.findByTestId('data-view')
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['task'] }))
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    const items = (await screen.findAllByRole('menuitemcheckbox')).map((i) => i.textContent)
    expect(items).toEqual(['List', 'Gallery', 'Wall', 'Table', 'Embed', 'Kanban'])
    expect(items).not.toContain('Gallery strip')
  })

  test('test full-view sections become header tabs', async () => {
    const q = query({ id: 'q1', name: 'Open tasks', definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'task' }] } })
    const c = collection({ id: 'c1', name: 'Reading', typeIds: ['task'] })
    mocked.queries.mockResolvedValue([q])
    mocked.collections.mockResolvedValue([c])
    load(views({}, [...SECTIONS, 'query:q1']))
    render(<TypePage type={TASK} />)
    await waitFor(() => expect(tabNames()).toHaveLength(6))
    // recentlyAccessed, collections and queries give none; the rest follow All in section order.
    expect(tabNames()).toEqual(['Overview', 'All', 'Not in any collection', 'Not tagged', 'Open tasks', 'Reading'])
  })

  test('test section tab menu Rename sets title and Remove moves key to removedSections', async () => {
    const user = userEvent.setup()
    mocked.collections.mockResolvedValue([])
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'Not tagged menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename Not tagged' })
    await user.clear(input)
    await user.type(input, 'Untagged{Enter}')
    expect(await screen.findByRole('tab', { name: 'Untagged' })).toBeInTheDocument()
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalled())
    expect(lastSaved()[1].dashboard.sections.find((s) => s.key === 'notTagged')?.title).toBe('Untagged')

    await user.click(screen.getByRole('button', { name: 'Untagged menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    expect(screen.queryByRole('tab', { name: 'Untagged' })).not.toBeInTheDocument()
    await waitFor(() => expect(lastSaved()[1].dashboard.removedSections).toEqual(['notTagged']))
    expect(lastSaved()[1].dashboard.sections.map((s) => s.key)).not.toContain('notTagged')
  })

  test('the tab menu opens a query or collection page', async () => {
    const user = userEvent.setup()
    const c = collection({ id: 'c1', name: 'Reading', typeIds: ['task'] })
    mocked.collections.mockResolvedValue([c])
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'Reading menu' }))
    expect(await screen.findByRole('menuitem', { name: 'Pin to sidebar' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Pin to...' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'collection', id: 'c1' })
  })

  test('test Customize Overview marks dashboard-only sections (Overview only)', async () => {
    const user = userEvent.setup()
    load(views({ activeTab: 'overview' }))
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'Customize Overview' }))
    const visible = (await screen.findAllByTestId('visible-section')).map((e) => e.textContent)
    expect(visible).toEqual([
      'Recently Opened (Overview only)',
      'Collections (Overview only)',
      'Queries (Overview only)',
      'Not in any collection',
      'Not tagged',
    ])
  })

  test('test hidden section moves to Hidden Sections and back', async () => {
    const user = userEvent.setup()
    load(views({ activeTab: 'overview' }))
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'Customize Overview' }))
    await user.click(await screen.findByRole('button', { name: 'Hide Collections' }))
    expect(screen.getByText('Hidden Sections')).toBeInTheDocument()
    expect(within(screen.getByTestId('hidden-section')).getByText('Collections (Overview only)')).toBeInTheDocument()
    expect(screen.getAllByTestId('visible-section')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Show Collections' }))
    expect(screen.queryByText('Hidden Sections')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('visible-section')).toHaveLength(5)
  })

  test('Add a section lists the queries of the type under "Queries & Views"', async () => {
    const user = userEvent.setup()
    const q = query({ id: 'q1', name: 'Open tasks', definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'task' }] } })
    mocked.queries.mockResolvedValue([q])
    load(views({ activeTab: 'overview' }))
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'Customize Overview' }))
    await user.click(await screen.findByRole('button', { name: 'Add a section' }))
    expect(await screen.findByText('Queries & Views')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add Open tasks' }))
    await waitFor(() => expect(lastSaved()[1].dashboard.sections.at(-1)).toEqual({ key: 'query:q1', collapsed: false }))
  })

  test('test recently opened shows only this type in a gallery strip', async () => {
    const other = objectSummary({ path: 'Pages/Home.md', type: 'page', title: 'Home' })
    useLinkIndex.setState({ objects: [...ROWS.map((r) => r.summary), other] })
    useRecent.setState({ paths: ['Pages/Home.md', 'Tasks/Beta.md', 'Tasks/Alpha.md'] })
    mocked.rows.mockImplementation(async (scope) => ROWS.filter((r) => !scope?.paths || scope.paths.includes(r.summary.path)))
    load(views({ activeTab: 'overview' }, ['recentlyAccessed']))
    render(<TypePage type={TASK} />)
    const strip = await screen.findByTestId('gallery')
    await waitFor(() => expect(within(strip).getAllByTestId('gallery-item')).toHaveLength(2))
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/Beta.md', 'Tasks/Alpha.md'] })
    // most recent first
    expect(within(strip).getAllByTestId('gallery-item').map((e) => e.textContent)).toEqual([
      expect.stringContaining('Beta'),
      expect.stringContaining('Alpha'),
    ])
  })

  test('the recently opened section is empty without recent objects of the type', async () => {
    load(views({ activeTab: 'overview' }, ['recentlyAccessed']))
    render(<TypePage type={TASK} />)
    expect(await screen.findByText('No recently accessed content')).toBeInTheDocument()
    expect(screen.getByText('Objects you recently accessed will appear here.')).toBeInTheDocument()
  })

  test('an uncustomised query shows its automatic title in the Queries section and as a tab', async () => {
    const q = query({
      id: 'q1',
      name: 'New Query',
      titleIsCustom: false,
      definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'task' }] },
    })
    mocked.queries.mockResolvedValue([q])
    load(views({ activeTab: 'overview' }, ['queries', 'query:q1']))
    render(<TypePage type={TASK} />)
    await waitFor(() => expect(tabNames()).toEqual(['Overview', 'All', 'Tasks']))
    expect(screen.queryByText('New Query')).toBeNull()
  })

  test('empty collections and queries sections show their empty states', async () => {
    load(views({ activeTab: 'overview' }, ['collections', 'queries']))
    render(<TypePage type={TASK} />)
    expect(await screen.findByText('No collections')).toBeInTheDocument()
    expect(screen.getByText('You can change this by creating a new collection.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create collection' })).toBeEnabled()
    expect(screen.getByText('No queries')).toBeInTheDocument()
    expect(screen.getByText('Queries you create in this database will appear here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create query' })).toBeInTheDocument()
  })

  test('Query Recommendations show without query sections and picking one creates the query', async () => {
    const user = userEvent.setup()
    load(views({ activeTab: 'overview' }, ['inNoCollection']))
    render(<TypePage type={TASK} />)
    const rec = await screen.findByTestId('query-recommendations')
    await user.click(within(rec).getByRole('button', { name: 'Task · Done · Checked' }))
    await waitFor(() => expect(mocked.createQuery).toHaveBeenCalled())
    expect(mocked.createQuery.mock.calls[0][0]).toMatchObject({
      name: 'Task · Done · Checked',
      definition: { structures: [{ id: 'task' }] },
    })
    await waitFor(() => expect(lastSaved()[1].dashboard.sections.at(-1)).toEqual({ key: 'query:new-query', collapsed: false }))
  })

  test('test New split button from M2 still lists templates', async () => {
    const user = userEvent.setup()
    const t = typeDef({ ...TASK, templates: { ids: ['tpl-a'], defaultTemplateId: null } })
    mocked.templates.mockResolvedValue([objectSummary({ path: 'Templates/Tasks/A.md', id: 'tpl-a', type: 'task', template: 'Kickoff' })])
    render(<TypePage type={t} />)
    await user.click(await screen.findByRole('button', { name: 'New from template' }))
    expect(await screen.findByRole('menuitem', { name: "New 'Kickoff'" })).toBeInTheDocument()
  })

  test('test New on filtered All tab passes matching values', async () => {
    const user = userEvent.setup()
    const v = views({ activeTab: 'all' })
    v.all = {
      ...v.all,
      filterGroup: {
        type: 'filterGroup',
        operator: 'and',
        elements: [{ type: 'filter', propertyId: 'done', option: 'isChecked', structureId: 'task' }],
      },
    }
    load(v)
    render(<TypePage type={TASK} />)
    await screen.findByTestId('data-view')
    await user.click(screen.getByRole('button', { name: 'New Task' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', { values: { done: true } }))
  })

  test('test Save as query creates query with type and filters and opens it', async () => {
    const user = userEvent.setup()
    const v = views({ activeTab: 'all' })
    const filterGroup = {
      type: 'filterGroup' as const,
      operator: 'and' as const,
      elements: [{ type: 'filter' as const, propertyId: 'done', option: 'isChecked', structureId: 'task' }],
    }
    v.all = { ...v.all, filterGroup, sorts: [{ propertyId: 'title', option: 'ascending' }] }
    load(v)
    render(<TypePage type={TASK} />)
    await screen.findByTestId('data-view')
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Save as query' }))
    await waitFor(() => expect(mocked.createQuery).toHaveBeenCalled())
    expect(mocked.createQuery.mock.calls[0][0]).toMatchObject({
      definition: {
        structures: [{ id: 'task' }],
        filterGroup,
        sorts: [{ propertyId: 'title', option: 'ascending' }],
        groupBy: null,
      },
    })
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'query', id: 'new-query' }))
  })

  test('Save as query is only offered on the All tab', async () => {
    const user = userEvent.setup()
    load(views({ activeTab: 'overview' }))
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: 'Object Type Settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Create collection' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('menuitem', { name: 'Save as query' })).not.toBeInTheDocument()
  })

  test('test the All tab toolbar sits in the tab row, right-aligned, under the header divider', async () => {
    const user = userEvent.setup()
    render(<TypePage type={TASK} />)
    await screen.findByTestId('data-view')
    const slot = screen.getByTestId('toolbar-slot')
    const toolbar = await screen.findByTestId('toolbar')
    expect(slot).toContainElement(toolbar)
    expect(toolbar.className).not.toMatch(/\bw-full\b/)
    expect(screen.getByRole('heading', { name: 'Tasks' }).closest('header')).toHaveClass('border-b')
    expect(screen.getByRole('tablist', { name: 'Views' })).not.toHaveClass('border-b')
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    await waitFor(() => expect(slot).toBeEmptyDOMElement())
  })

  test('test search title filters the All view client-side', async () => {
    const user = userEvent.setup()
    render(<TypePage type={TASK} />)
    await screen.findByTestId('data-view')
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4))
    const calls = mocked.rows.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.type(screen.getByPlaceholderText('Search title...'), 'a')
    // "a" is in Alpha, Alphabet, Beta and Gamma; narrow it further.
    await user.type(screen.getByPlaceholderText('Search title...'), 'lph')
    await waitFor(() => expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Alpha', 'Alphabet']))
    expect(mocked.rows.mock.calls.length).toBe(calls)
    // The search is not saved, and clears when the tab changes.
    expect(mocked.saveViews).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByPlaceholderText('Search title...')).toHaveValue('')
  })

  test('search matches aliases', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([mk('Tasks/Alpha.md', 'Alpha', { aliases: ['first'] }), mk('Tasks/Beta.md', 'Beta')])
    render(<TypePage type={TASK} />)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.type(screen.getByPlaceholderText('Search title...'), 'FIRS')
    await waitFor(() => expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Alpha']))
  })

  test('a saved section tab that no longer exists falls back to the Overview', async () => {
    load(views({ activeTab: 'query:gone' }))
    render(<TypePage type={TASK} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'))
  })

  test('test Task type page has no Overview tab', async () => {
    const BASIC = { ...TASK, basic: true }
    load(views({ activeTab: 'overview' }))
    useLinkIndex.setState({ types: [BASIC], objects: ROWS.map((r) => r.summary), loaded: true })
    render(<TypePage type={BASIC} />)
    // A saved `overview` is ignored: All is shown, and the tabs are All plus the section tabs.
    expect(await screen.findByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
    expect(tabNames()[0]).toBe('All')
    await screen.findByText('Alpha')
  })

  test('other types keep the Overview tab', async () => {
    load(views({ activeTab: 'overview' }))
    render(<TypePage type={{ ...TASK, id: 'page', name: 'Page', basic: true }} />)
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })

  test('a 409 on save reloads the views, re-applies the edit and saves again', async () => {
    const { ConflictError } = await import('@/api/client')
    const user = userEvent.setup()
    load(views({ activeTab: 'all' }))
    mocked.saveViews.mockRejectedValueOnce(new ConflictError('r9')).mockResolvedValue({ revision: 'r10' })
    mocked.views.mockResolvedValueOnce({ views: views({ activeTab: 'all' }), revision: 'r0' })
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('tab', { name: 'Overview' }))
    mocked.views.mockResolvedValue({ views: views({ activeTab: 'all' }), revision: 'r9' })
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalledTimes(2))
    expect(mocked.saveViews.mock.calls[1][2]).toBe('r9')
    expect(mocked.saveViews.mock.calls[1][1].activeTab).toBe('overview')
    await act(async () => undefined)
  })

  test('Create collection opens the dialog, creates for the type and opens the collection', async () => {
    const user = userEvent.setup()
    load(views({ activeTab: 'overview' }, ['collections']))
    mocked.createCollection.mockResolvedValue(collection({ id: 'new-collection', name: 'New Collection', typeIds: ['task'], revision: 'r1' }))
    render(<TypePage type={TASK} />)
    await user.click(await screen.findByRole('button', { name: 'Create collection' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create collection' }))
    await waitFor(() => expect(mocked.createCollection).toHaveBeenCalledWith('New Collection', ['task']))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'collection', id: 'new-collection' }))
  })
})
