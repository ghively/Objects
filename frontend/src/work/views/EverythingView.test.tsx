// M23 Task 11: Everything: every item (board `all`) in a sortable table the top bar's search filters.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('../state/workActions', async (orig) => ({
  ...(await orig<typeof import('../state/workActions')>()),
  openItemPanel: vi.fn(),
}))

import { api } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import { workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { everythingRows } from '../logic/everything'
import { openItemPanel } from '../state/workActions'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { useWorkSelection } from '../state/useWorkSelection'
import { useWorkUi } from '../state/useWorkUi'
import { EverythingView } from './EverythingView'
import { setWorkOn } from '@/test/workOn'

// M32: Work is on for the space in these tests (while it is off, nothing of the Work page runs).
beforeEach(() => setWorkOn())

const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const OLD_CLEANUP = workBoardItem({
  path: 'Tasks/Old cleanup.md',
  title: 'Old cleanup',
  stage: 'done',
  done: true,
  recentlyDone: false,
  turn: 'none',
  lastTouched: '2026-10-01T09:00:00.000Z',
})
const ALL: WorkBoard = { ...BOARD, items: [...BOARD.items, OLD_CLEANUP] }
const mocked = vi.mocked(api)

function View() {
  const data = useWorkData()
  return <EverythingView data={data} now={NOW} />
}

const titles = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.getAttribute('data-title'))

describe('EverythingView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    useWorkUi.setState({ everythingSort: { key: 'score', dir: -1 } })
    useWorkSelection.setState({ list: [], index: -1 })
    mocked.workBoard.mockImplementation(async (scope) => (scope === 'all' ? ALL : BOARD))
  })

  test('test the nine headers in order', async () => {
    useWorkData.setState({ all: ALL })
    render(<View />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Type', 'Ticket ID', 'Title', 'Area', 'Stage', 'Whose turn', 'Priority', 'Quiet days', 'Score'])
  })

  test('test it loads the all board on first show and lists old cleanup', async () => {
    useWorkData.setState({ board: BOARD })
    render(<View />)
    await waitFor(() => expect(screen.getByText('Old cleanup')).toBeInTheDocument())
    expect(mocked.workBoard).toHaveBeenCalledWith('all')
  })

  test('test default sort is score descending', () => {
    useWorkData.setState({ all: ALL })
    render(<View />)
    const want = everythingRows(ALL.items, NOW, { key: 'score', dir: -1 }).map((i) => i.title)
    expect(titles()).toEqual(want)
    expect(screen.getByRole('columnheader', { name: 'Score' })).toHaveAttribute('aria-sort', 'descending')
  })

  test('test clicking title sorts ascending, again descending', () => {
    useWorkData.setState({ all: ALL })
    render(<View />)
    const byTitle = [...ALL.items].map((i) => i.title).sort((a, b) => a.localeCompare(b))
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Title' })).getByRole('button'))
    expect(titles()).toEqual(byTitle)
    expect(useWorkUi.getState().everythingSort).toEqual({ key: 'title', dir: 1 })
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Title' })).getByRole('button'))
    expect(titles()).toEqual([...byTitle].reverse())
    expect(screen.getByRole('columnheader', { name: 'Title' })).toHaveAttribute('aria-sort', 'descending')
  })

  test('test the search filter: only the rows the page passes show, and all stays loaded', () => {
    // The top bar's search filters the board the page hands its view (WorkPage, T9); Everything
    // shows exactly those rows and doesn't reload the all board because it is filtered.
    useWorkData.setState({ all: ALL })
    const narrowed = (q: string): WorkBoard => ({
      ...ALL,
      items: ALL.items.filter((i) => [i.title, i.ticket?.id ?? '', i.area ?? ''].some((v) => v.toLowerCase().includes(q))),
    })
    const r = render(<EverythingView data={{ ...useWorkData.getState(), all: narrowed('ops-123') }} now={NOW} />)
    expect(titles()).toEqual(['Badge reader audit'])
    r.rerender(<EverythingView data={{ ...useWorkData.getState(), all: narrowed('') }} now={NOW} />)
    expect(titles()).toHaveLength(ALL.items.length)
    r.rerender(<EverythingView data={{ ...useWorkData.getState(), all: { ...ALL, items: [] } }} now={NOW} />)
    expect(screen.getAllByRole('row')).toHaveLength(1)
    expect(mocked.workBoard).not.toHaveBeenCalled()
  })

  test('test the rows are the j/k order and a row click opens the panel', () => {
    useWorkData.setState({ all: ALL })
    render(<View />)
    const want = everythingRows(ALL.items, NOW, { key: 'score', dir: -1 }).map((i) => i.path)
    expect(useWorkSelection.getState().list).toEqual(want)
    const row = screen.getByText('Old cleanup').closest('tr') as HTMLElement
    expect(row).toHaveAttribute('data-work-row', 'Tasks/Old cleanup.md')
    fireEvent.click(row)
    expect(openItemPanel).toHaveBeenCalledWith('Tasks/Old cleanup.md')
    const first = screen.getAllByRole('row')[1]
    expect(first).toHaveAttribute('aria-selected', 'true')
  })
})
