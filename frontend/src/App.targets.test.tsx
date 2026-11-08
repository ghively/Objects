import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'
import { collection, query, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import App from './App'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.collections.mockResolvedValue([collection({ id: 'reading', name: 'Reading list', typeIds: ['page'], icon: { type: 'iconify', val: 'ph-books' } })])
  mocked.queries.mockResolvedValue([query({ id: 'open', name: 'Open pages' }), query({ id: 'auto', name: 'New Query', titleIsCustom: false, definition: { types: [{ id: 'page' }], filterGroup: { type: 'filterGroup', operator: 'and', elements: [] }, sorts: [], groupBy: null } })])
  mocked.onChange.mockReturnValue(() => undefined)
})

describe('new targets', () => {
  test('test collection, query, queries and allNotes targets open, go back and show tab labels', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'collection', id: 'reading' })
    render(<App />)
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    await waitFor(() => expect(within(strip).getByText('Reading list')).toBeInTheDocument())
    expect(await screen.findByRole('textbox', { name: 'Collection name' })).toHaveValue('Reading list')

    useTabs.getState().open({ kind: 'query', id: 'open' })
    await waitFor(() => expect(within(strip).getByText('Open pages')).toBeInTheDocument())
    useTabs.getState().open({ kind: 'query', id: 'auto' })
    // An uncustomised query's tab shows its automatic title, as its page does.
    await waitFor(() => expect(within(strip).getByText('Pages')).toBeInTheDocument())
    expect(within(strip).queryByText('New Query')).toBeNull()
    useTabs.getState().open({ kind: 'queries' })
    await waitFor(() => expect(within(strip).getByText('Queries')).toBeInTheDocument())
    useTabs.getState().open({ kind: 'allNotes' })
    await waitFor(() => expect(within(strip).getByText('All notes')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'queries' })
    await waitFor(() => expect(within(strip).getByText('Queries')).toBeInTheDocument())
  })
})
