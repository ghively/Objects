// M23 Task 10: the Now view: the card for the best item on Gene's turn, Not now, Up next, a
// selected focus line showing only its own work (Review Focus 3), the empty states, Close, and the
// card's buttons.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { FocusDay, WorkBoard, WorkBoardItem } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { agentStatus, focusDay, workAlerts, workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { score } from '../logic/scoring'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { loadWorkUi, useWorkUi } from '../state/useWorkUi'
import { resetWorkToasts } from '../state/workToasts'
import { NowView } from './NowView'

const mocked = vi.mocked(api)
const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const TOMORROW = new Date('2026-11-06T10:00:00.000Z')
const PRINTER = 'Tasks/Printer jams on line 3.md'

const item = (title: string): WorkBoardItem => BOARD.items.find((i) => i.title === title)!

function show(over: Partial<Parameters<typeof useWorkData.setState>[0]> = {}, now = NOW) {
  useWorkData.setState({
    board: BOARD,
    focus: focusDay([]),
    today: { day: '2026-11-05', now: NOW.toISOString(), nowLocal: '10:00', meetings: [] },
    alerts: workAlerts(),
    agent: agentStatus(),
    needsYou: [],
    ...over,
  })
  return render(<NowView data={useWorkData.getState()} now={now} />)
}

const card = () => document.querySelector('[data-now-card]') as HTMLElement | null

/** A focus day whose line `n` links the given paths. */
function linkedFocus(lines: { text: string; paths: string[] }[]): FocusDay {
  const day = focusDay(lines.map((l) => l.text))
  day.lines = day.lines.map((l, i) => ({ ...l, links: lines[i].paths.map((p) => ({ target: p, path: p })) }))
  return day
}

describe('NowView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    window.localStorage.clear()
    loadWorkUi(null)
    resetWorkData()
    resetWorkToasts()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('test the card shows the best item for you', () => {
    show()
    const printer = item('Printer jams on line 3')
    // Desk priority Medium (30) + rank 1 (23) + touched in the last day (15).
    expect(score(printer, NOW)).toBe(68)
    const c = card()!
    expect(c).toHaveAttribute('data-now-card', PRINTER)
    expect(within(c).getByRole('heading', { name: 'Printer jams on line 3' })).toBeInTheDocument()
    expect(within(c).getByText('First tiny step')).toBeInTheDocument()
    expect(within(c).getByText('Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
    expect(within(c).getByText('Step 2 of 3')).toBeInTheDocument()
    expect(within(c).getByText('Low energy · ~2 min')).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    expect(within(c).getByText('Where you left off')).toBeInTheDocument()
    expect(within(c).getByText(printer.lastActivity!.text)).toBeInTheDocument()
    expect(within(c).getByText('Hypothesis')).toBeInTheDocument()
    expect(within(c).getByText('Medium confidence')).toBeInTheDocument()
  })

  test('test not now moves it to the back for today', () => {
    show()
    fireEvent.click(within(card()!).getByRole('button', { name: 'Not now' }))
    expect(card()).toHaveAttribute('data-now-card', 'Tasks/Scanner firmware.md')
    expect(useWorkUi.getState().notNow.paths).toEqual([PRINTER])
    cleanup()
    // Tomorrow it is first again.
    vi.setSystemTime(TOMORROW)
    show({}, TOMORROW)
    expect(card()).toHaveAttribute('data-now-card', PRINTER)
  })

  test('test up next shows three and the rest hidden on purpose', () => {
    show()
    const up = document.querySelector('[data-now-side="upNext"]') as HTMLElement
    expect(within(up).getByText('Up next')).toBeInTheDocument()
    const rows = up.querySelectorAll('[data-now-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Scanner firmware')
    expect(rows[0]).toHaveTextContent('Which firmware build is on the floor units?')
    // Seven items are Gene's: the card, three shown, three hidden.
    expect(within(up).getByText('+3 more hidden on purpose')).toBeInTheDocument()
  })

  test('test a selected focus line shows only its work', () => {
    useWorkUi.getState().setFocusLine(1)
    show({ focus: linkedFocus([{ text: '[[Scanner rollout]]', paths: ['Projects/Scanner rollout.md'] }]) })
    // Scanner firmware is the project's task, on Gene's turn, with a Question.
    expect(card()).toHaveAttribute('data-now-card', 'Tasks/Scanner firmware.md')
    expect(within(card()!).getByLabelText('Type the answer')).toBeInTheDocument()
    expect(screen.queryByText('Printer jams on line 3')).toBeNull()
  })

  test('test the empty states', () => {
    const notMine = BOARD.items.filter((i) => i.turn !== 'you' && i.turn !== 'approve' && i.turn !== 'close')
    const { unmount } = show({ board: { ...BOARD, items: notMine } })
    expect(card()).toBeNull()
    expect(screen.getByText('Nothing is waiting on you')).toBeInTheDocument()
    expect(screen.getByText('All quiet')).toBeInTheDocument()
    unmount()

    // A line whose work is all done: Focus 1 cleared, and Show everything again clears it.
    useWorkUi.getState().setFocusLine(1)
    show({ focus: linkedFocus([{ text: '[[Last week fix]]', paths: ['Tasks/Last week fix.md'] }]) })
    expect(card()).toBeNull()
    expect(screen.getByText('Focus 1 cleared')).toBeInTheDocument()
    expect(screen.queryByText('Printer jams on line 3')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show everything again' }))
    expect(useWorkUi.getState().focusLine).toBeNull()
  })

  test('test the focus empty states for a line linking nothing or nothing of yours', () => {
    useWorkUi.getState().setFocusLine(1)
    const { unmount } = show({ focus: linkedFocus([{ text: 'Think about labels', paths: [] }]) })
    expect(screen.getByText('No work is linked to this focus line yet.')).toBeInTheDocument()
    unmount()
    show({ focus: linkedFocus([{ text: '[[Order toner]]', paths: ['Tasks/Order toner.md'] }]) })
    expect(screen.getByText('Nothing in focus 1 is waiting on you.')).toBeInTheDocument()
  })

  test('test close offers Close and the desk mark', async () => {
    const desk = item('Desk closed it')
    show({ board: { ...BOARD, items: [desk] } })
    const c = card()!
    expect(within(c).getByText('Every step is done.')).toBeInTheDocument()
    expect(within(c).getByText('Desk says Resolved')).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: 'Done' })).toBeNull()
    await act(async () => {
      fireEvent.click(within(c).getByRole('button', { name: 'Close' }))
    })
    expect(mocked.workClose).toHaveBeenCalledWith('Tasks/Desk closed it.md', desk.version)
  })

  test('test the buttons open the session, Make it smaller and the panel', () => {
    const spy = vi.spyOn(useTabs.getState(), 'openInSidepanel').mockImplementation(() => {})
    show()
    const c = card()!
    fireEvent.click(within(c).getByRole('button', { name: 'Start together' }))
    expect(useWorkOverlay.getState().session).toEqual({ path: PRINTER })
    fireEvent.click(within(c).getByRole('button', { name: 'Make it smaller' }))
    expect(useWorkOverlay.getState().smaller).toEqual({ path: PRINTER, stepId: 'r8k1pd' })
    useWorkOverlay.getState().close()
    expect(spy).not.toHaveBeenCalled()
    fireEvent.click(within(c).getByRole('button', { name: 'Details' }))
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: PRINTER, work: true })
    spy.mockClear()
    // A click on the card's empty area opens the panel too.
    fireEvent.click(c)
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: PRINTER, work: true })
    spy.mockRestore()
  })

  test('test the side shows agent carrying, next meeting, deadlines, alerts and wins', () => {
    const agentJob = workBoardItem({ path: 'Tasks/Agent job.md', title: 'Agent job', turn: 'agent', stage: 'doing' })
    show({
      board: { ...BOARD, items: [...BOARD.items, agentJob] },
      today: {
        day: '2026-11-05',
        now: NOW.toISOString(),
        nowLocal: '10:00',
        meetings: [
          { path: 'Meetings/Standup.md', title: 'Standup', start: '2026-11-05T09:00:00Z', end: '2026-11-05T09:30:00Z', startLocal: '09:00', endLocal: '09:30' },
          { path: 'Meetings/Review.md', title: 'Line review', start: '2026-11-05T13:00:00Z', end: '2026-11-05T13:30:00Z', startLocal: '13:00', endLocal: '13:30' },
        ],
      },
      alerts: workAlerts({
        alerts: [
          { path: 'Alerts/a.md', title: 'Tray 2 jammed', source: 'printer-watch', severity: 'Critical', message: null, raisedAt: null, clearedAt: null, link: null, active: true },
          { path: 'Alerts/b.md', title: 'Toner low', source: 'printer-watch', severity: 'Info', message: null, raisedAt: null, clearedAt: null, link: null, active: true },
        ],
      }),
      wins: {
        days: [{ day: '2026-11-05', stepsDone: 2, itemsClosed: 0, objectsChanged: 3 }],
        stepsDone: 9,
        itemsClosed: 1,
        objectsChanged: 12,
        got: [],
      },
    })
    const side = (k: string) => document.querySelector(`[data-now-side="${k}"]`) as HTMLElement
    expect(within(side('meeting')).getByText('Line review')).toBeInTheDocument()
    expect(within(side('meeting')).getByText('13:00')).toBeInTheDocument()
    expect(within(side('deadlines')).getByText('Waiting on Pat')).toBeInTheDocument()
    const days = within(side('deadlines')).getByText('7 days')
    expect(days.closest('[data-tone]')).toHaveAttribute('data-tone', 'high')
    expect(within(side('alerts')).getByText('Tray 2 jammed')).toBeInTheDocument()
    expect(within(side('alerts')).queryByText('Toner low')).toBeNull()
    expect(side('wins')).toHaveTextContent('2')
    expect(side('wins')).toHaveTextContent('9')
    expect(within(side('agent')).getByText('Agent job')).toBeInTheDocument()
    expect(within(side('agent')).queryByText('Printer jams on line 3')).toBeNull()
    // No parked dumps: the widget hides.
    expect(document.querySelector('[data-now-side="dumps"]')).toBeNull()
  })
})
