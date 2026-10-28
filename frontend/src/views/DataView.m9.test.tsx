// M9 Task 18: multi-select in a data view ("Select multiple") and the bulk actions.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Layout, Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { DataView, type Pipeline } from './DataView'
import { emptyFilterGroup } from './model'

const mocked = vi.mocked(api)
const TITLE = propertyDef({ id: 'title', type: 'entity_title', name: 'Title' })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', propertyDefinitions: [TITLE] })
const BOOK = typeDef({ id: 'book', name: 'Book', pluralName: 'Books', propertyDefinitions: [TITLE] })

const mk = (title: string, createdAt: string) =>
  row({ summary: objectSummary({ path: `Pages/${title}.md`, type: 'page', title, createdAt }), version: `v-${title}` })
// No sort: newest first, so the view order is A, B, C, D.
const ROWS = [mk('A', '2026-10-04T00:00:00Z'), mk('B', '2026-10-03T00:00:00Z'), mk('C', '2026-10-02T00:00:00Z'), mk('D', '2026-10-01T00:00:00Z')]

function Harness({ layout = 'list', rows = ROWS, pipeline }: { layout?: Layout; rows?: Row[]; pipeline?: Pipeline }) {
  const [state, setState] = useState<ViewState>({
    viewDefinition: { dataViewLayout: layout },
    filterGroup: emptyFilterGroup(),
    sorts: [],
    groupBy: null,
  })
  return (
    <DataView rows={rows} types={[PAGE, BOOK]} scope={{ typeIds: ['page'] }} state={state} onState={setState} layouts={['list', 'grid', 'table']} rowActions pipeline={pipeline} />
  )
}

const rowEl = (title: string) => document.querySelector(`[data-path="Pages/${title}.md"]`) as HTMLElement
const selectedTitles = () =>
  [...document.querySelectorAll('[data-selected]')].map((el) =>
    (el.getAttribute('data-path') ?? el.querySelector('[data-path]')?.getAttribute('data-path'))?.replace(/^Pages\/|\.md$/g, ''),
  )

async function startSelecting(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.pointer({ keys: '[MouseRight]', target: rowEl(title) })
  await user.click(await screen.findByRole('menuitem', { name: 'Select multiple' }))
}

beforeEach(() => {
  resetLinkIndex()
  useTabs.getState().reset()
  usePeek.getState().close()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.deleteObject.mockResolvedValue({ trashId: 't' })
  mocked.suggestMapping.mockResolvedValue([])
  mocked.changeType.mockImplementation(async (path) => ({ path, version: 'v2', relinked: [] }) as never)
})

describe('DataView multi-select (Task 18)', () => {
  test('test select multiple then click toggles rows', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'B')
    expect(selectedTitles()).toEqual(['B'])
    await user.click(screen.getByText('D'))
    expect(selectedTitles()).toEqual(['B', 'D'])
    await user.click(screen.getByText('B'))
    expect(selectedTitles()).toEqual(['D'])
    // Clicking selects; it does not open the peek.
    expect(usePeek.getState().path).toBeNull()
  })

  test('test shift click selects range', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('C'))
    await user.keyboard('{/Shift}')
    expect(selectedTitles()).toEqual(['A', 'B', 'C'])
  })

  test('test shift click in a grouped view selects the on-screen range', async () => {
    // Two groups whose on-screen order (A, C | B, D) differs from the flat order (A, B, C, D).
    const pipeline: Pipeline = (rows) => ({
      rows,
      groups: [
        { id: 'g1', label: 'One', rows: [rows[0], rows[2]] },
        { id: 'g2', label: 'Two', rows: [rows[1], rows[3]] },
      ],
    })
    const user = userEvent.setup()
    render(<Harness pipeline={pipeline} />)
    await startSelecting(user, 'A')
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('C'))
    await user.keyboard('{/Shift}')
    expect(selectedTitles().sort()).toEqual(['A', 'C'])
  })

  test('test bar shows count', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    await user.click(screen.getByText('C'))
    const bar = screen.getByTestId('selection-bar')
    expect(bar).toHaveTextContent('2 selected')
    expect(within(bar).getByRole('button', { name: 'Change type of selected objects' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Open selected objects in side panel' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Delete objects' })).toBeInTheDocument()
  })

  test('test bulk delete confirms with count string', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    await user.click(screen.getByText('B'))
    await user.click(screen.getByRole('button', { name: 'Delete objects' }))
    const dialog = await screen.findByRole('alertdialog')
    // Capacities' `DeleteHandler.fallback` heading and description.
    expect(within(dialog).getByRole('heading', { name: 'Delete?' })).toBeInTheDocument()
    expect(within(dialog).getByText('Review the items below, then confirm.')).toBeInTheDocument()
    expect(within(within(dialog).getByRole('list', { name: 'Items' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['A', 'B'])
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 objects' }))
    await waitFor(() => expect(mocked.deleteObject).toHaveBeenCalledTimes(2))
    expect(mocked.deleteObject).toHaveBeenCalledWith('Pages/A.md', { baseVersion: 'v-A' })
    expect(mocked.deleteObject).toHaveBeenCalledWith('Pages/B.md', { baseVersion: 'v-B' })
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull())
  })

  test('test bulk delete of one object says "Delete 1 object"', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    await user.click(screen.getByRole('button', { name: 'Delete objects' }))
    expect(await screen.findByRole('button', { name: 'Delete 1 object' })).toBeInTheDocument()
  })

  test('test bulk change type', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    await user.click(screen.getByText('B'))
    await user.click(screen.getByRole('button', { name: 'Change type of selected objects' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Book' }))
    // One dialog per object, in view order.
    await waitFor(() => expect(mocked.suggestMapping).toHaveBeenCalledWith('Pages/A.md', 'book'))
    await user.click(await screen.findByRole('button', { name: 'Change type' }))
    await waitFor(() => expect(mocked.changeType).toHaveBeenCalledWith('Pages/A.md', 'book', {}, 'v-A'))
    await waitFor(() => expect(mocked.suggestMapping).toHaveBeenCalledWith('Pages/B.md', 'book'))
    await user.click(await screen.findByRole('button', { name: 'Change type' }))
    await waitFor(() => expect(mocked.changeType).toHaveBeenCalledWith('Pages/B.md', 'book', {}, 'v-B'))
  })

  test('test bulk open in side panel', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    await user.click(screen.getByText('B'))
    const spy = vi.spyOn(useTabs.getState(), 'openInSidepanel')
    await user.click(screen.getByRole('button', { name: 'Open selected objects in side panel' }))
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'object', path: 'Pages/A.md' },
      { kind: 'object', path: 'Pages/B.md' },
    ])
  })

  test('test escape clears', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await startSelecting(user, 'A')
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('selection-bar')).toBeNull()
    expect(selectedTitles()).toEqual([])
  })

  test('test table and card rows show the selection', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness layout="table" />)
    await startSelecting(user, 'B')
    expect(selectedTitles()).toEqual(['B'])
    unmount()
    render(<Harness layout="grid" />)
    await startSelecting(user, 'C')
    expect(selectedTitles()).toEqual(['C'])
  })
})
