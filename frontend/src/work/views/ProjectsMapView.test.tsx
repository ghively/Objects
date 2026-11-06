// M23 Task 11: the Projects map: one card per line with its stations, progress and next step.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../state/workActions', async (orig) => ({
  ...(await orig<typeof import('../state/workActions')>()),
  openItemPanel: vi.fn(),
}))

import type { WorkBoard } from '@/api/types'
import { workBoard } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { openItemPanel } from '../state/workActions'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { ProjectsMapView } from './ProjectsMapView'

const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

function show(board: WorkBoard = BOARD) {
  useWorkData.setState({ board })
  return render(<ProjectsMapView data={useWorkData.getState()} now={NOW} />)
}

const card = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('[data-map-line]') as HTMLElement

describe('ProjectsMapView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
  })

  test("test scanner rollout's line: its step waiting, then scanner firmware doing", () => {
    show()
    const line = card('Scanner rollout')
    const stations = [...line.querySelectorAll('[data-station]')]
    expect(stations.map((s) => s.getAttribute('data-state'))).toEqual(['waiting', 'doing'])
    expect(within(line).getByText('2 open')).toBeInTheDocument()
    expect(within(line).getByText('0% done')).toBeInTheDocument()
    expect(within(line).getByText('Next for you: Install the new scanner on line 2')).toBeInTheDocument()
    expect(within(line).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  test('test the printers area line', () => {
    show()
    const line = card('Printers')
    const stations = [...line.querySelectorAll('[data-station]')]
    expect(stations).toHaveLength(1)
    expect(stations[0]).toHaveAttribute('data-state', 'doing')
    expect(within(line).getByText('Next for you: Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
  })

  test('test a station click opens its item', () => {
    show()
    const line = card('Scanner rollout')
    const stations = [...line.querySelectorAll('[data-station]')] as HTMLElement[]
    fireEvent.click(stations[1])
    expect(openItemPanel).toHaveBeenCalledWith('Tasks/Scanner firmware.md')
    fireEvent.click(stations[0])
    expect(openItemPanel).toHaveBeenLastCalledWith('Projects/Scanner rollout.md')
  })

  test('test no board, no lines', () => {
    show(workBoard([]))
    expect(document.querySelectorAll('[data-map-line]')).toHaveLength(0)
  })
})
