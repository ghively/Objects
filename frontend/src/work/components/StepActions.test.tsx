// M23 Task 8: a step's inline actions: two-press Approve, Not before, Decline with a reason,
// Withdraw, Run now and Done, the answer box; only the current step and only the server's actions.
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { WorkStep } from '@/api/types'
import { useSettings } from '@/settings/useSettings'
import { workStep } from '@/test/mockApi'
import { resetWorkData } from '../state/useWorkData'
import { resetWorkToasts } from '../state/workToasts'
import { StepActions } from './StepActions'

const mocked = vi.mocked(api)
const PATH = 'Tasks/Printer jams on line 3.md'
const item = { path: PATH, title: 'Printer jams on line 3', ticket: null }

const approveStep = workStep({ id: 'a2', rev: 'aaaaaaaaaaaa', n: 2, kind: 'approve', state: 'open', actions: ['approve', 'decline'] })

function show(step: WorkStep, compact = false) {
  return render(<StepActions item={item} step={step} compact={compact} />)
}

const lastStep = () => mocked.workStep.mock.calls.at(-1)?.[0]

describe('StepActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: null } })
  })

  test('test approve needs two presses', async () => {
    vi.useFakeTimers()
    show(approveStep)
    const btn = screen.getByRole('button', { name: 'Approve' })
    fireEvent.click(btn)
    expect(btn).toHaveTextContent('Press again to approve')
    expect(mocked.workStep).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(btn).toHaveTextContent('Approve')
    expect(btn).not.toHaveTextContent('Press again')
    fireEvent.click(btn)
    expect(mocked.workStep).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(mocked.workStep).toHaveBeenCalledTimes(1)
    expect(lastStep()).toEqual({ path: PATH, stepId: 'a2', stepRev: 'aaaaaaaaaaaa', action: 'approve' })
  })

  test('test not before goes with the approval', async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: 'America/Chicago' } })
    const user = userEvent.setup()
    show(approveStep)
    expect(screen.queryByLabelText('Not before')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Not before' }))
    fireEvent.change(screen.getByLabelText('Not before'), { target: { value: '2026-11-06T09:00' } })
    const btn = screen.getByRole('button', { name: 'Approve' })
    await user.click(btn)
    expect(mocked.workStep).not.toHaveBeenCalled()
    await user.click(btn)
    // 09:00 in Chicago on 6 November 2026 (CST, UTC-6) is 15:00 UTC.
    expect(lastStep()).toEqual({
      path: PATH, stepId: 'a2', stepRev: 'aaaaaaaaaaaa', action: 'approve', notBefore: '2026-11-06T15:00:00.000Z',
    })
  })

  test('test decline with a reason', async () => {
    const user = userEvent.setup()
    show(approveStep)
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(mocked.workStep).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'Wait for the vendor')
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(lastStep()).toEqual({ path: PATH, stepId: 'a2', stepRev: 'aaaaaaaaaaaa', action: 'decline', text: 'Wait for the vendor' })
  })

  test('test decline without a reason sends no text', async () => {
    const user = userEvent.setup()
    show(approveStep)
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(lastStep()).toEqual({ path: PATH, stepId: 'a2', stepRev: 'aaaaaaaaaaaa', action: 'decline' })
  })

  test('test withdraw on an approved step', async () => {
    const user = userEvent.setup()
    show(workStep({ id: 'a2', rev: 'bbbbbbbbbbbb', kind: 'approve', state: 'approved', actions: ['decline', 'reopen'] }))
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(lastStep()).toEqual({ path: PATH, stepId: 'a2', stepRev: 'bbbbbbbbbbbb', action: 'reopen' })
  })

  test('test run now and done on an agent step', async () => {
    const user = userEvent.setup()
    const { unmount } = show(workStep({ id: 'g4', rev: 'cccccccccccc', kind: 'agent', state: 'open', actions: ['done', 'run'] }))
    await user.click(screen.getByRole('button', { name: 'Run now' }))
    expect(lastStep()).toEqual({ path: PATH, stepId: 'g4', stepRev: 'cccccccccccc', action: 'run' })
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(lastStep()).toEqual({ path: PATH, stepId: 'g4', stepRev: 'cccccccccccc', action: 'done' })
    unmount()
    show(workStep({ id: 'g4', kind: 'agent', state: 'approved', actions: ['done', 'reopen'] }))
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  test('test answer box sends on Enter', async () => {
    const user = userEvent.setup()
    show(workStep({ id: 'q1', rev: 'dddddddddddd', kind: 'question', actions: ['answer'] }))
    const box = screen.getByRole('textbox', { name: 'Type the answer' })
    await user.type(box, '{Enter}')
    expect(mocked.workStep).not.toHaveBeenCalled()
    await user.type(box, '   {Enter}')
    expect(mocked.workStep).not.toHaveBeenCalled()
    await user.clear(box)
    await user.type(box, 'Tray 2{Enter}')
    expect(lastStep()).toEqual({ path: PATH, stepId: 'q1', stepRev: 'dddddddddddd', action: 'answer', text: 'Tray 2' })
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  test('test done on a do step sends the note', async () => {
    const user = userEvent.setup()
    show(workStep({ id: 'd3', rev: 'eeeeeeeeeeee', kind: 'do', actions: ['done'] }))
    await user.type(screen.getByRole('textbox', { name: 'What you found' }), 'Cable was loose')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(lastStep()).toEqual({ path: PATH, stepId: 'd3', stepRev: 'eeeeeeeeeeee', action: 'done', text: 'Cable was loose' })
  })

  test('test a step that is not current renders nothing', () => {
    const { container } = show(workStep({ id: 'd3', kind: 'do', current: false, actions: ['done'] }))
    expect(container).toBeEmptyDOMElement()
  })

  test('test only the actions the server allows show', () => {
    const { container, unmount } = show(workStep({ id: 'd3', kind: 'do', state: 'open', actions: [] }))
    expect(container).toBeEmptyDOMElement()
    unmount()
    show(workStep({ id: 'a2', kind: 'approve', state: 'open', actions: ['decline'] }))
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Not before' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })
})
