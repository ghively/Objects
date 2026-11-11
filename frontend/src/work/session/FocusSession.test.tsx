// M23 Task 15: the focus session: a 25-minute timer, Step done by the step's kind, Pause, Too big
// and "Tell the agent what you see" (a capture, 501 until M24 fills the seam).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { resetWorkToasts } from '../state/workToasts'
import { WorkOverlays } from './WorkOverlays'
import { setWorkOn } from '@/test/workOn'

// M32: Work is on for the space in these tests (while it is off, nothing of the Work page runs).
beforeEach(() => setWorkOn())

const mocked = vi.mocked(api)
const BOARD = boardJson as unknown as WorkBoard
const PRINTER = 'Tasks/Printer jams on line 3.md'
const BADGE = 'Tasks/Badge reader audit.md'
const SCANNER = 'Tasks/Scanner firmware.md'

function session(path: string) {
  useWorkData.setState({ board: BOARD })
  const r = render(<WorkOverlays />)
  act(() => useWorkOverlay.getState().openSession(path))
  return r
}

const dialog = () => screen.getByRole('dialog')

describe('FocusSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
    useWorkOverlay.getState().close()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('test the timer starts at 25:00 and counts down', () => {
    vi.useFakeTimers()
    session(PRINTER)
    expect(within(dialog()).getByText('25:00')).toBeInTheDocument()
    expect(within(dialog()).getByText('Printer jams on line 3')).toBeInTheDocument()
    expect(within(dialog()).getByText('Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(within(dialog()).getByText('23:59')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(25 * 60_000)
    })
    expect(within(dialog()).getByText("Time's up")).toBeInTheDocument()
    // It stays open at 0:00.
    expect(useWorkOverlay.getState().session).toEqual({ path: PRINTER })
  })

  test('test step done on a do step sends done and closes', async () => {
    session(BADGE)
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Step done' }))
    })
    expect(mocked.workStep).toHaveBeenCalledWith(
      expect.objectContaining({ path: BADGE, stepId: 'b7c2nd', stepRev: 'b15ed9dba4f8', action: 'done' }),
    )
    expect(useWorkOverlay.getState().session).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('test step done on a question reveals the answer box', async () => {
    session(SCANNER)
    expect(within(dialog()).queryByRole('textbox', { name: 'Type the answer' })).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Step done' }))
    const box = within(dialog()).getByRole('textbox', { name: 'Type the answer' })
    expect(mocked.workStep).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'Build 4.2' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(mocked.workStep).toHaveBeenCalledWith(
      expect.objectContaining({ path: SCANNER, stepId: 'f2q7wb', action: 'answer', text: 'Build 4.2' }),
    )
    // The session closes after the action lands.
    expect(useWorkOverlay.getState().session).toBeNull()
  })

  test('test step done on an approve step reveals its actions', () => {
    session(PRINTER)
    expect(within(dialog()).queryByRole('button', { name: 'Approve' })).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Step done' }))
    expect(within(dialog()).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  test('test tell the agent sends the capture with the item path', async () => {
    mocked.workCapture.mockResolvedValueOnce({
      path: 'Captures/x.md', text: '[INC0012345] saw E-12', status: 'new', question: null,
      capturedAt: '2026-11-05T10:00:00.000Z', linkedPath: PRINTER,
    })
    session(PRINTER)
    const box = within(dialog()).getByRole('textbox', { name: 'Tell the agent what you see' })
    fireEvent.change(box, { target: { value: 'saw E-12' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(mocked.workCapture).toHaveBeenCalledWith({
      text: '[INC0012345] saw E-12',
      fromView: 'focusSession',
      linkedPath: PRINTER,
    })
    expect(box).toHaveValue('')
  })

  test('test a 501 keeps the text and shows the detail', async () => {
    session(PRINTER)
    const box = within(dialog()).getByRole('textbox', { name: 'Tell the agent what you see' })
    fireEvent.change(box, { target: { value: 'saw E-12' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(await within(dialog()).findByText('Saving a brain dump comes with M24.')).toBeInTheDocument()
    expect(box).toHaveValue('saw E-12')
  })

  test('test pause sends the paused capture and closes', async () => {
    session(PRINTER)
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Pause' }))
    })
    expect(mocked.workCapture).toHaveBeenCalledWith({
      text: '[INC0012345] paused a focus session here',
      fromView: 'focusSession',
      linkedPath: PRINTER,
    })
    expect(useWorkOverlay.getState().session).toBeNull()
    // The 501 is skipped silently.
    await waitFor(() => expect(mocked.workCapture.mock.results[0]?.type).toBe('return'))
    await mocked.workCapture.mock.results[0].value.catch(() => undefined)
    await act(async () => {})
    const { useWorkToasts } = await import('../state/workToasts')
    expect(useWorkToasts.getState().toasts).toEqual([])
  })

  test('test too big opens make it smaller', () => {
    session(PRINTER)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Too big' }))
    expect(useWorkOverlay.getState().smaller).toEqual({ path: PRINTER, stepId: 'r8k1pd' })
    expect(useWorkOverlay.getState().session).toBeNull()
    expect(screen.getByRole('button', { name: 'Replace the step with these' })).toBeInTheDocument()
  })

  test('test esc closes', () => {
    session(PRINTER)
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(useWorkOverlay.getState().session).toBeNull()
  })
})
