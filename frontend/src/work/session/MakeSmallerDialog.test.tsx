// M23 Task 15: Make it smaller: drafts from the step's text, Replace (one steps write: the drafts
// as Do steps before the step, then its removal) and "Ask the agent to break it down" (a capture).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, StepChangedError } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { resetWorkToasts, useWorkToasts } from '../state/workToasts'
import { WorkOverlays } from './WorkOverlays'
import { setWorkOn } from '@/test/workOn'

// M32: Work is on for the space in these tests (while it is off, nothing of the Work page runs).
beforeEach(() => setWorkOn())

const mocked = vi.mocked(api)
const BOARD = boardJson as unknown as WorkBoard
const PRINTER = 'Tasks/Printer jams on line 3.md'
const STEP = 'Restart the print spooler on PRN-TEST-01'

function smaller(path = PRINTER, stepId = 'r8k1pd') {
  useWorkData.setState({ board: BOARD })
  const r = render(<WorkOverlays />)
  act(() => useWorkOverlay.getState().openSmaller(path, stepId))
  return r
}

const dialog = () => screen.getByRole('dialog')
const drafts = () => within(dialog()).getAllByRole('textbox', { name: /^Draft \d$/ }) as HTMLInputElement[]

describe('MakeSmallerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
    useWorkOverlay.getState().close()
  })

  test('test drafts come from the step text', () => {
    smaller()
    expect(within(dialog()).getByText(STEP)).toBeInTheDocument()
    // One piece only: the step framed by our two lines.
    expect(drafts().map((d) => d.value)).toEqual(['Get what you need for this step', STEP, 'Write down what you found'])
    expect(within(dialog()).getAllByText('~2 min')).toHaveLength(3)
  })

  test('test replace sends one steps call with the adds before the step and its removal', async () => {
    smaller()
    fireEvent.change(drafts()[0], { target: { value: 'Find the spooler service' } })
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Replace the step with these' }))
    })
    expect(mocked.workSteps).toHaveBeenCalledTimes(1)
    expect(mocked.workSteps).toHaveBeenCalledWith(PRINTER, [
      { op: 'add', kind: 'do', text: 'Find the spooler service', before: 'r8k1pd' },
      { op: 'add', kind: 'do', text: STEP, before: 'r8k1pd' },
      { op: 'add', kind: 'do', text: 'Write down what you found', before: 'r8k1pd' },
      { op: 'remove', stepId: 'r8k1pd', stepRev: '5d8a71fff518' },
    ])
    expect(useWorkOverlay.getState().smaller).toBeNull()
  })

  test('test a refusal shows its message', async () => {
    mocked.workSteps.mockRejectedValueOnce(new StepChangedError('This step changed. Look again.', 'v9'))
    smaller()
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Replace the step with these' }))
    })
    expect(within(dialog()).getByText('This step changed. Look again.')).toBeInTheDocument()
    expect(useWorkOverlay.getState().smaller).not.toBeNull()
  })

  test('test replace is only for an open step', () => {
    // Printer's step 1 is a done Question.
    smaller(PRINTER, 'q4m2xa')
    expect(within(dialog()).queryByRole('button', { name: 'Replace the step with these' })).toBeNull()
  })

  test('test ask the agent sends the break down capture', async () => {
    mocked.workCapture.mockResolvedValueOnce({
      path: 'Captures/x.md', text: '', status: 'new', question: null,
      capturedAt: '2026-11-05T10:00:00.000Z', linkedPath: PRINTER,
    })
    smaller()
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Ask the agent to break it down' }))
    })
    expect(mocked.workCapture).toHaveBeenCalledWith(
      expect.objectContaining({ text: `Break down INC0012345 step 2: ${STEP}`, linkedPath: PRINTER }),
    )
    expect(useWorkOverlay.getState().smaller).toBeNull()
  })

  test('test a 501 shows a toast with the detail', async () => {
    smaller()
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Ask the agent to break it down' }))
    })
    await waitFor(() =>
      expect(useWorkToasts.getState().toasts.map((t) => t.text)).toEqual(['Saving a brain dump comes with M24.']),
    )
  })

  test('test close closes', () => {
    smaller()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(useWorkOverlay.getState().smaller).toBeNull()
  })
})
