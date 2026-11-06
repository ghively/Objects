// M23 Task 13: the Agent queue: before M24 the switch is disabled with the seam's note and Queued
// lists the board's agent-turn items; with a live status the three sections fill.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { AgentQueueRow, WorkBoard } from '@/api/types'
import { agentStatus, workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { resetWorkToasts } from '../state/workToasts'
import { AgentQueueView } from './AgentQueueView'

const mocked = vi.mocked(api)
const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

const AGENT_ITEM = workBoardItem({ path: 'Tasks/Agent run.md', title: 'Agent run', turn: 'agent', stage: 'doing' })

function row(over: Partial<AgentQueueRow>): AgentQueueRow {
  return {
    id: 'q1',
    path: 'Tasks/Printer jams on line 3.md',
    title: 'Printer jams on line 3',
    stepId: 't2n7vc',
    n: 3,
    stepText: 'Run 20 test prints and check the spooler',
    reason: 'approved',
    state: 'pending',
    notBefore: null,
    createdAt: '2026-11-05T09:00:00.000Z',
    claimedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    ...over,
  }
}

function show(agent = agentStatus({ carrying: 1 })) {
  useWorkData.setState({ board: { ...BOARD, items: [...BOARD.items, AGENT_ITEM] }, agent })
  return render(<AgentQueueView data={useWorkData.getState()} now={NOW} />)
}

const section = (name: string) => screen.getByRole('region', { name })

describe('AgentQueueView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
  })

  test('test before M24 the switch is disabled with the note and queued lists agent-turn items', () => {
    show()
    const sw = screen.getByRole('switch', { name: 'Agent acts on my approvals' })
    expect(sw).toBeDisabled()
    expect(screen.getByText('The agent loop comes with M24.')).toBeInTheDocument()
    const queued = section('Queued')
    expect(within(queued).getByText('Agent run')).toBeInTheDocument()
    expect(within(queued).getByText('Waiting for the agent')).toBeInTheDocument()
    expect(within(queued).queryByText('Printer jams on line 3')).toBeNull()
    expect(within(section('Working on')).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(section('Failed')).queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.click(sw)
    expect(mocked.setAgentActs).not.toHaveBeenCalled()
  })

  test('test a live status fills the three sections, retry and the switch call the seams', async () => {
    const live = agentStatus({
      available: true,
      agentName: 'Work agent',
      note: null,
      carrying: 3,
      rows: [
        row({ id: 'r1', state: 'running', title: 'Scanner rollout', stepText: 'Install the new scanner on line 2' }),
        row({ id: 'p1', state: 'pending', notBefore: '2026-11-05T14:00:00.000Z' }),
        row({ id: 'f1', state: 'failed', title: 'Badge reader audit', error: 'The run stopped: no answer' }),
      ],
    })
    mocked.retryAgentEntry.mockResolvedValueOnce({ ...live, rows: live.rows.filter((r) => r.id !== 'f1') })
    mocked.setAgentActs.mockResolvedValueOnce({ ...live, actsOnApprovals: true })
    show(live)
    expect(within(section('Working on')).getByText('Scanner rollout')).toBeInTheDocument()
    const queued = section('Queued')
    expect(within(queued).getByText('Printer jams on line 3')).toBeInTheDocument()
    expect(within(queued).getByText(/^Not before /)).toBeInTheDocument()
    // the board's agent-turn items are the fallback only while the agent is unavailable
    expect(within(queued).queryByText('Agent run')).toBeNull()
    const failed = section('Failed')
    expect(within(failed).getByText('The run stopped: no answer')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }))
    })
    expect(mocked.retryAgentEntry).toHaveBeenCalledWith('f1')
    expect(useWorkData.getState().agent?.rows.some((r) => r.id === 'f1')).toBe(false)
    const sw = screen.getByRole('switch', { name: 'Agent acts on my approvals' })
    expect(sw).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(sw)
    })
    expect(mocked.setAgentActs).toHaveBeenCalledWith(true)
    expect(useWorkData.getState().agent?.actsOnApprovals).toBe(true)
  })
})
