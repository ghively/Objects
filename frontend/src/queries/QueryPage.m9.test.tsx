// M9 Task 17: the row menu on a query page; Task 20: type-constrained query tabs.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Query, QueryDefinition, Row } from '@/api/types'
import { defaultViews, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'

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

const mk = (path: string, title: string) => row({ summary: objectSummary({ path, type: 'server', title }), version: `v-${title}` })
const ROWS: Row[] = [mk('Servers/Alpha.md', 'Alpha'), mk('Servers/Beta.md', 'Beta')]

const def = (over: Partial<QueryDefinition> = {}): QueryDefinition => ({
  types: [{ id: 'server' }],
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: null,
  ...over,
})
const Q = (over: Partial<Query> = {}) => query({ id: 'q1', name: 'Open servers', revision: 'q1r', definition: def(), ...over })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([Q()])
  mocked.rows.mockResolvedValue(ROWS)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.views.mockResolvedValue({ views: defaultViews(), revision: 'v0' })
  useLinkIndex.setState({ types: [SERVER, PAGE], objects: ROWS.map((r) => r.summary), loaded: true })
})

describe('QueryPage row menu (Task 17)', () => {
  test('test query page row menu', async () => {
    const user = userEvent.setup()
    render(<QueryPage id="q1" />)
    const alpha = (await screen.findByText('Alpha')).closest('[data-path]') as HTMLElement
    await user.pointer({ keys: '[MouseRight]', target: alpha })
    const menu = await screen.findByTestId('row-menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Select multiple',
      'Open in side panel',
      'Open in new tab',
      'Change type',
      'Copy object reference',
      'Duplicate',
      'Delete Object',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Open in new tab' }))
    expect(useTabs.getState().tabs.length).toBeGreaterThan(0)
  })
})
