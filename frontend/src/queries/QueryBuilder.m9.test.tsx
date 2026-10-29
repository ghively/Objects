// M9 Task 20: a single-type query shown as a tab on its type's dashboard is constrained to that
// type; "release" unpins the tab and opens the query as a page.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Query, QueryDefinition, Views } from '@/api/types'
import { defaultViews, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { useRecent } from '@/nav/recent'
import { TypePage } from '@/types/TypePage'
import { useDefs } from '@/types/useDefinitions'
import { BUILDER_TEXT, QueryBuilder, isSingleTypeQuery } from './QueryBuilder'

const mocked = vi.mocked(api)
const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const BOOK = typeDef({ id: 'book', name: 'Book', pluralName: 'Books', revision: 'r1', propertyDefinitions: [TITLE] })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', propertyDefinitions: [TITLE] })

const def = (ids: string[]): QueryDefinition => ({
  structures: ids.map((id) => ({ id })),
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: null,
})
const Q = (ids: string[]): Query => query({ id: 'q1', name: 'Unread', titleIsCustom: true, revision: 'q1r', definition: def(ids) })

function tabViews(): Views {
  const v = defaultViews()
  return { ...v, activeTab: 'query:q1', dashboard: { sections: [{ key: 'query:q1', collapsed: false }], removedSections: [] } }
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useRecent.getState().clear()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.views.mockResolvedValue({ views: tabViews(), revision: 'r0' })
  mocked.saveViews.mockResolvedValue({ revision: 'r1' })
  mocked.rows.mockResolvedValue([row({ summary: objectSummary({ path: 'Books/Dune.md', type: 'book', title: 'Dune' }) })])
  mocked.collections.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.saveQuery.mockImplementation(async (q: Query) => ({ query: { ...q, revision: `${q.revision}+1` } }))
  useLinkIndex.setState({ types: [BOOK, PAGE], objects: [], loaded: true })
})

describe('type-constrained query tabs', () => {
  test('isSingleTypeQuery: exactly one type, and it is this type', () => {
    expect(isSingleTypeQuery(def(['book']), 'book')).toBe(true)
    expect(isSingleTypeQuery(def(['page']), 'book')).toBe(false)
    expect(isSingleTypeQuery(def(['book', 'page']), 'book')).toBe(false)
    expect(isSingleTypeQuery(def([]), 'book')).toBe(false)
  })

  test('test single type query tab locks type picker', async () => {
    const user = userEvent.setup()
    mocked.queries.mockResolvedValue([Q(['book'])])
    render(<TypePage type={BOOK} />)
    await user.click(await screen.findByRole('button', { name: 'Edit query' }))
    const lock = await screen.findByTestId('query-type-lock')
    expect(within(lock).getByText('Book')).toBeInTheDocument()
    // No way to change the type: no "All", no remove, no "Add object type".
    const builder = screen.getByTestId('query-builder')
    expect(within(builder).queryByRole('button', { name: 'Add object type' })).toBeNull()
    expect(within(builder).queryByRole('button', { name: 'All' })).toBeNull()
    expect(within(builder).queryByRole('button', { name: 'Remove Book' })).toBeNull()
    expect(within(lock).getByRole('button', { name: BUILDER_TEXT.releaseConstraint })).toHaveAttribute(
      'title',
      'Turn into a normal query and remove the single type constraint. Opens the query as a page and removes this tab from the type dashboard.',
    )
  })

  test('test release removes tab and opens query page', async () => {
    const user = userEvent.setup()
    mocked.queries.mockResolvedValue([Q(['book'])])
    render(<TypePage type={BOOK} />)
    await user.click(await screen.findByRole('button', { name: 'Edit query' }))
    await user.click(await screen.findByRole('button', { name: BUILDER_TEXT.releaseConstraint }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'query', id: 'q1' })
    expect(screen.queryByRole('tab', { name: 'Unread' })).toBeNull()
    // The views save after the usual delay.
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalled(), { timeout: 3000 })
    const saved = mocked.saveViews.mock.calls.at(-1)![1]
    expect(saved.dashboard.sections.map((s) => s.key)).not.toContain('query:q1')
    expect(saved.dashboard.removedSections).not.toContain('query:q1')
    expect(saved.activeTab).not.toBe('query:q1')
  })

  test('test multi type query is not constrained', async () => {
    const user = userEvent.setup()
    mocked.queries.mockResolvedValue([Q(['book', 'page'])])
    render(<TypePage type={BOOK} />)
    await user.click(await screen.findByRole('button', { name: 'Edit query' }))
    expect(await screen.findByTestId('query-builder')).toBeInTheDocument()
    expect(screen.queryByTestId('query-type-lock')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add object type' })).toBeInTheDocument()
  })

  test('the builder edits the query from the tab', async () => {
    const user = userEvent.setup()
    mocked.queries.mockResolvedValue([Q(['book', 'page'])])
    render(<TypePage type={BOOK} />)
    await user.click(await screen.findByRole('button', { name: 'Edit query' }))
    await user.click(await screen.findByRole('button', { name: 'Remove Page' }))
    await waitFor(() => expect(useDefs.getState().queries[0].definition.structures).toEqual([{ id: 'book' }]))
    // Now single-type: locked.
    expect(await screen.findByTestId('query-type-lock')).toBeInTheDocument()
  })

  test('on its own page a single-type query is not constrained', () => {
    render(<QueryBuilder query={Q(['book'])} types={[BOOK, PAGE]} collections={[]} onChange={() => undefined} />)
    expect(screen.queryByTestId('query-type-lock')).toBeNull()
  })
})
