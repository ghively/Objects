// M23 Task 13: Stuck: blocked and quiet 7+ days, waiting on someone, failed agent runs (hidden
// while the agent is unavailable).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AgentQueueRow, WorkBoard, WorkBoardItem } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { agentStatus, workBoard, workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { StuckView } from './StuckView'

const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

const FRESH = workBoardItem({
  path: 'Tasks/Labels from Pat.md',
  title: 'Labels from Pat',
  stage: 'doing',
  turn: 'you',
  blockedOn: '[[Pat Example]] to send the labels',
  blockedOnPeople: [{ path: 'People/Pat Example.md', title: 'Pat Example' }],
  lastTouched: '2026-11-05T08:00:00.000Z',
})

const FAILED: AgentQueueRow = {
  id: 'f1',
  path: 'Tasks/Badge reader audit.md',
  title: 'Badge reader audit',
  stepId: 'b7c2nd',
  n: 1,
  stepText: 'List the badge readers at the east door',
  reason: 'run now',
  state: 'failed',
  notBefore: null,
  createdAt: '2026-11-05T08:00:00.000Z',
  claimedAt: '2026-11-05T08:01:00.000Z',
  finishedAt: '2026-11-05T08:05:00.000Z',
  result: null,
  error: 'The run stopped',
}

function show(items: WorkBoardItem[] = [...BOARD.items, FRESH], agent = agentStatus()) {
  useWorkData.setState({ board: { ...BOARD, items }, agent })
  return render(<StuckView data={useWorkData.getState()} now={NOW} />)
}

const section = (name: string) => screen.getByRole('region', { name })

describe('StuckView', () => {
  beforeEach(() => {
    resetWorkData()
  })

  test('test waiting on pat is blocked and quiet with its quiet days', () => {
    show()
    const blocked = section('Blocked and quiet for 7+ days')
    expect(within(blocked).getByText('Waiting on Pat')).toBeInTheDocument()
    expect(within(blocked).getByText('11 days quiet')).toBeInTheDocument()
    expect(within(blocked).getByText(/to send the badge list/)).toBeInTheDocument()
    // Parked thing was touched three days ago: not quiet long enough
    expect(within(blocked).queryByText('Parked thing')).toBeNull()
  })

  test('test a fresh item naming pat is waiting on someone', () => {
    const spy = vi.spyOn(useTabs.getState(), 'openInSidepanel').mockImplementation(() => {})
    show()
    const waiting = section('Waiting on someone')
    expect(within(waiting).getByText('Labels from Pat')).toBeInTheDocument()
    expect(within(waiting).queryByText('Waiting on Pat')).toBeNull()
    fireEvent.click(within(waiting).getByRole('button', { name: 'Pat Example' }))
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: 'People/Pat Example.md' })
    spy.mockRestore()
  })

  test('test failed agent runs are hidden while unavailable and shown with rows', () => {
    const r = show()
    expect(screen.queryByRole('region', { name: 'Failed agent runs' })).toBeNull()
    r.unmount()
    show(undefined, agentStatus({ available: true, note: null, rows: [FAILED] }))
    const failed = section('Failed agent runs')
    expect(within(failed).getByText('Badge reader audit')).toBeInTheDocument()
    expect(within(failed).getByText('The run stopped')).toBeInTheDocument()
  })

  test('test nothing is stuck', () => {
    useWorkData.setState({ board: workBoard([]), agent: agentStatus() })
    render(<StuckView data={useWorkData.getState()} now={NOW} />)
    expect(screen.getByText('Nothing is stuck')).toBeInTheDocument()
  })
})
