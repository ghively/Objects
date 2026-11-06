import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Query, Row } from '@/api/types'
import { defaultViews, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { QUERY_TEXT, QueryPage, TICKETS_NOTE } from './QueryPage'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const TICKET = propertyDef({ id: 'ticketId', key: 'ticketId', name: 'Ticket ID', type: 'text' })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', revision: 'r1', basic: true, propertyDefinitions: [TITLE, TICKET] })

const ROWS: Row[] = [
  row({
    summary: objectSummary({ path: 'Tasks/Printer jams on line 3.md', type: 'task', title: 'Printer jams on line 3' }),
    values: { ticketId: 'INC0012345' },
    version: 'v1',
  }),
]

const TICKETS: Query = query({
  id: 'work-tickets',
  name: 'Tickets',
  titleIsCustom: true,
  icon: { type: 'iconify', val: 'ph-ticket' },
  description: 'Every work item with a Ticket ID.',
  builtIn: 'tickets',
  revision: '',
  definition: {
    structures: [{ id: 'task' }],
    filterGroup: { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'ticketId', option: 'isNotEmpty' }] },
    sorts: [{ propertyId: 'deskUpdated', option: 'descending' }],
    groupBy: null,
  },
})

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
  mocked.rows.mockResolvedValue(ROWS)
  useLinkIndex.setState({ types: [TASK], objects: ROWS.map((r) => r.summary), loaded: true })
})

describe('QueryPage: the Tickets view', () => {
  test('shows the note, no type picker and no Delete', async () => {
    const user = userEvent.setup()
    mocked.queries.mockResolvedValue([TICKETS])
    render(<QueryPage id="work-tickets" />)
    expect(await screen.findByText('Printer jams on line 3')).toBeInTheDocument()
    expect(screen.getByText(TICKETS_NOTE)).toBeInTheDocument()
    expect(TICKETS_NOTE).toBe('Lists every work item with a Ticket ID.')
    // No builder (whose Types section is the type picker) and no button to open it.
    expect(screen.queryByRole('button', { name: QUERY_TEXT.edit })).not.toBeInTheDocument()
    expect(screen.queryByTestId('query-builder')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Types' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: QUERY_TEXT.delete })).not.toBeInTheDocument()
  })

  test('an ordinary query keeps its type picker, Delete and no note', async () => {
    const user = userEvent.setup()
    const plain = { ...TICKETS, id: 'q1', name: 'Open tickets', builtIn: undefined }
    mocked.queries.mockResolvedValue([plain])
    render(<QueryPage id="q1" />)
    expect(await screen.findByText('Printer jams on line 3')).toBeInTheDocument()
    expect(screen.queryByText(TICKETS_NOTE)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: QUERY_TEXT.edit }))
    expect(screen.getByRole('region', { name: 'Types' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: QUERY_TEXT.delete })).toBeInTheDocument()
  })
})
