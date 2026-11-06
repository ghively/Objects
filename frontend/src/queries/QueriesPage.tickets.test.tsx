// M23 Task 17: the built-in Tickets view is listed under Work, not in the Queries list.
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { query, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { QueriesPage } from './QueriesPage'

const mocked = vi.mocked(api)
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1' })

beforeEach(() => {
  useTabs.getState().reset()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  useLinkIndex.setState({ types: [SERVER], objects: [], loaded: true })
})

describe('QueriesPage and the Tickets view', () => {
  test('test the work-tickets query is not listed; other queries are', async () => {
    mocked.queries.mockResolvedValue([
      query({ id: 'work-tickets', name: 'Tickets', revision: 't', builtIn: 'tickets' }),
      query({ id: 'abc', name: 'Another', revision: 'b' }),
      query({ id: 'zed', name: 'Zed list', revision: 'z' }),
    ])
    render(<QueriesPage />)
    const list = await screen.findByRole('list', { name: 'Queries' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-query-row'))).toEqual(['abc', 'zed'])
    expect(within(list).queryByText('Tickets')).toBeNull()
  })

  test('test with only the Tickets view the list is empty', async () => {
    mocked.queries.mockResolvedValue([query({ id: 'work-tickets', name: 'Tickets', revision: 't', builtIn: 'tickets' })])
    render(<QueriesPage />)
    expect(await screen.findByText('No queries')).toBeInTheDocument()
  })
})
