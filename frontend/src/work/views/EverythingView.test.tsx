// M23 Task 11: Everything: every item (board `all`) in a sortable table the top bar's search filters.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { EverythingView, useWorkSearch } from './EverythingView'

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
    useWorkSearch.setState({ query: '' })
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

  test('test the search filters by title, ticket id or area', () => {
    useWorkData.setState({ all: ALL })
    render(<View />)
    act(() => useWorkSearch.getState().setQuery('printer'))
    expect(titles()).toEqual(['Printer jams on line 3'])
    act(() => useWorkSearch.getState().setQuery('ops-123'))
    expect(titles()).toEqual(['Badge reader audit'])
    act(() => useWorkSearch.getState().setQuery('Scanners'))
    expect(titles()).toEqual(['Scanner firmware'])
    act(() => useWorkSearch.getState().setQuery(''))
    expect(titles()).toHaveLength(ALL.items.length)
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
