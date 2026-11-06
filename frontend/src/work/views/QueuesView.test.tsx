// M23 Task 13: Your queues: four columns by the current step, inline actions, and only the current
// step of an item ever offers anything (Review Focus 3).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { resetWorkToasts } from '../state/workToasts'
import { QueuesView } from './QueuesView'

const mocked = vi.mocked(api)
const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

function show() {
  useWorkData.setState({ board: BOARD })
  return render(<QueuesView data={useWorkData.getState()} now={NOW} />)
}

const column = (key: string) => document.querySelector(`[data-queue="${key}"]`) as HTMLElement
const card = (title: string) => screen.getByText(title).closest('[data-work-card]') as HTMLElement

describe('QueuesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
  })

  test('test the four columns with their counts', () => {
    show()
    const headers = ['Answer', 'Do', 'Approve', 'Agent running']
    expect([...document.querySelectorAll('[data-queue] h3 span:first-child')].map((e) => e.textContent)).toEqual(headers)
    expect(within(column('approve')).getByText('Printer jams on line 3')).toBeInTheDocument()
    expect(within(column('approve')).getByText('Scanner rollout')).toBeInTheDocument()
    expect(column('approve').querySelector('[data-queue-count]')).toHaveTextContent('2')
  })

  test('test parked thing is in no column', () => {
    show()
    // Its current step is an open Question, but a parked item waits on no one's queue.
    expect(screen.queryByText('Parked thing')).toBeNull()
    expect(screen.queryByText('Which shift needs the new labels first?')).toBeNull()
  })

  test('test badge reader is in do and printer in approve with a two-press approve', async () => {
    show()
    expect(within(column('do')).getByText('Badge reader audit')).toBeInTheDocument()
    const printer = card('Printer jams on line 3')
    expect(column('approve')).toContainElement(printer)
    const approve = within(printer).getByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    expect(approve).toHaveTextContent('Press again to approve')
    expect(mocked.workStep).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(approve)
    })
    expect(mocked.workStep).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve', stepId: 'r8k1pd' }))
  })

  test('test only the current step offers actions', () => {
    show()
    const printer = card('Printer jams on line 3')
    // Step 3 is an open Agent step behind the open Approve step 2: Approve only, no Run now.
    expect(column('agent')).not.toContainElement(printer)
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
    expect(within(printer).queryByText('Run 20 test prints and check the spooler')).toBeNull()
    expect(within(printer).getByText('Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
    expect(within(printer).getByText('+1 later steps waiting')).toBeInTheDocument()
    expect(within(printer).getAllByRole('group')).toHaveLength(1)
  })

  test('test answering sends answer with the text and the card vanishes', async () => {
    show()
    const scanner = card('Scanner firmware')
    expect(column('answer')).toContainElement(scanner)
    fireEvent.change(within(scanner).getByLabelText('Type the answer'), { target: { value: 'Build 4.2' } })
    await act(async () => {
      fireEvent.click(within(scanner).getByRole('button', { name: 'Send' }))
    })
    expect(mocked.workStep).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Tasks/Scanner firmware.md', stepId: 'f2q7wb', action: 'answer', text: 'Build 4.2' }),
    )
    expect(screen.queryByText('Scanner firmware')).toBeNull()
  })

  test('test a card title opens the panel', async () => {
    const { useTabs } = await import('@/nav/tabs')
    const spy = vi.spyOn(useTabs.getState(), 'openInSidepanel').mockImplementation(() => {})
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Badge reader audit' }))
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: 'Tasks/Badge reader audit.md', work: true })
    spy.mockRestore()
  })
})
