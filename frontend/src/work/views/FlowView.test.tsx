// M23 Task 11: the Flow board: lanes by whose turn, columns by stage, the Doing limit, the area
// filter, the Done window and stale tiles.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../state/workActions', async (orig) => ({
  ...(await orig<typeof import('../state/workActions')>()),
  openItemPanel: vi.fn(),
}))

import type { WorkBoard, WorkBoardItem } from '@/api/types'
import { workBoard, workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { openItemPanel } from '../state/workActions'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import { FlowView } from './FlowView'

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

function show(items: WorkBoardItem[] = BOARD.items) {
  useWorkData.setState({ board: { ...BOARD, items } })
  return render(<FlowView data={useWorkData.getState()} now={NOW} />)
}

const cell = (lane: string, column: string) =>
  document.querySelector(`[data-lane="${lane}"][data-column="${column}"]`) as HTMLElement

describe('FlowView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    useWorkUi.setState({ flowArea: null })
  })

  test('test items land in their lane and column', () => {
    const agentItem = workBoardItem({ path: 'Tasks/Agent run.md', title: 'Agent run', turn: 'agent', stage: 'doing' })
    show([...BOARD.items, agentItem])
    expect(within(cell('agent', 'doing')).getByText('Agent run')).toBeInTheDocument()
    expect(within(cell('others', 'parked')).getByText('Parked thing')).toBeInTheDocument()
    expect(within(cell('you', 'doing')).getByText('Printer jams on line 3')).toBeInTheDocument()
    expect(within(cell('you', 'doing')).getByText('INC0012345')).toBeInTheDocument()
    // the current step shows on the tile
    expect(within(cell('you', 'doing')).getByText('Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
    // Blocked on sends Waiting on Pat to Others
    expect(within(cell('others', 'doing')).getByText('Waiting on Pat')).toBeInTheDocument()
    expect(within(cell('you', 'notStarted')).getByText('Badge reader audit')).toBeInTheDocument()
    // the headers
    for (const h of ['You', 'Agent', 'Others', 'Not started', 'Ready', 'Doing', 'Waiting / parked', 'Done (14 days)']) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0)
    }
  })

  test('test four you items in doing show overloaded', () => {
    const mk = (n: number) =>
      workBoardItem({ path: `Tasks/T${n}.md`, title: `T${n}`, turn: 'you', stage: 'doing', blockedOn: null })
    const r = show([mk(1), mk(2), mk(3)])
    expect(screen.getByText('You: 3 / 3')).toBeInTheDocument()
    expect(screen.queryByText('Overloaded')).toBeNull()
    r.unmount()
    show([mk(1), mk(2), mk(3), mk(4)])
    expect(screen.getByText('You: 4 / 3')).toBeInTheDocument()
    expect(screen.getByText('Overloaded').closest('[data-tone]')).toHaveAttribute('data-tone', 'critical')
  })

  test('test the area filter narrows', () => {
    show()
    const filter = screen.getByLabelText('Area') as HTMLSelectElement
    expect([...filter.options].map((o) => o.text)).toEqual(['All areas', 'Printers', 'Scanners'])
    fireEvent.change(filter, { target: { value: 'Scanners' } })
    expect(useWorkUi.getState().flowArea).toBe('Scanners')
    expect(screen.getByText('Scanner firmware')).toBeInTheDocument()
    expect(screen.queryByText('Printer jams on line 3')).toBeNull()
    fireEvent.change(filter, { target: { value: '' } })
    expect(useWorkUi.getState().flowArea).toBeNull()
    expect(screen.getByText('Printer jams on line 3')).toBeInTheDocument()
  })

  test('test done holds only the last 14 days', () => {
    show([...BOARD.items, OLD_CLEANUP])
    expect(within(cell('others', 'done')).getByText('Last week fix')).toBeInTheDocument()
    expect(screen.queryByText('Old cleanup')).toBeNull()
  })

  test('test a stale tile is dimmed with its quiet days', () => {
    show()
    const tile = screen.getByText('Waiting on Pat').closest('[data-work-tile]') as HTMLElement
    expect(tile).toHaveAttribute('data-stale', 'true')
    expect(within(tile).getByText('11 days quiet')).toBeInTheDocument()
    const fresh = screen.getByText('Printer jams on line 3').closest('[data-work-tile]') as HTMLElement
    expect(fresh).not.toHaveAttribute('data-stale')
  })

  test('test a tile click opens the panel', () => {
    show()
    fireEvent.click(screen.getByText('Scanner firmware'))
    expect(openItemPanel).toHaveBeenCalledWith('Tasks/Scanner firmware.md')
  })

  test('test an empty board renders the empty grid', () => {
    useWorkData.setState({ board: workBoard([]) })
    render(<FlowView data={useWorkData.getState()} now={NOW} />)
    expect(screen.getByText('You: 0 / 3')).toBeInTheDocument()
  })
})
